import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../config/env_config.dart';
import '../config/stealth_system_prompt.dart';

/// Real [Anthropic Messages API](https://docs.anthropic.com/en/api/messages) client.
/// No mock responses — every reply comes from HTTP POST to api.anthropic.com.
class ChatTurn {
  const ChatTurn({required this.role, required this.text});
  final String role; // "user" | "assistant"
  final String text;
}

class AnthropicApiException implements Exception {
  AnthropicApiException(this.message, {this.statusCode});
  final String message;
  final int? statusCode;
  @override
  String toString() => 'AnthropicApiException: $message';
}

/// Evidence row displayed to staff/debug so they can see why the bot answered the way it did.
class EvidenceCitation {
  const EvidenceCitation({
    required this.idx,
    required this.type,
    required this.id,
    this.heading,
    this.productSlug,
    this.subsystem,
    this.score = 0.0,
  });
  final int idx;
  final String type; // chunk | canonical | snippet
  final String id;
  final String? heading;
  final String? productSlug;
  final String? subsystem;
  final double score;
}

/// Structured reply from the Anthropic proxy — keeps backward compat via [text].
class ClaudeReply {
  const ClaudeReply({
    required this.text,
    this.evidence = const [],
    this.resolvedProduct,
    this.auditId,
  });
  final String text;
  final List<EvidenceCitation> evidence;
  final String? resolvedProduct;
  final String? auditId;
}

/// Event from [AnthropicClaudeService.completeStream].
/// - `delta` carries incremental text as Claude generates it.
/// - `done` carries the final accumulated [ClaudeReply] with evidence/meta.
/// - `error` carries a terminal error message.
class ClaudeStreamEvent {
  const ClaudeStreamEvent.delta(this.text)
      : kind = ClaudeStreamEventKind.delta,
        reply = null,
        error = null;
  const ClaudeStreamEvent.done(this.reply)
      : kind = ClaudeStreamEventKind.done,
        text = '',
        error = null;
  const ClaudeStreamEvent.error(this.error)
      : kind = ClaudeStreamEventKind.error,
        text = '',
        reply = null;

  final ClaudeStreamEventKind kind;
  final String text;
  final ClaudeReply? reply;
  final String? error;
}

enum ClaudeStreamEventKind { delta, done, error }

class AnthropicClaudeService {
  AnthropicClaudeService({
    required SupabaseClient client,
    required this.model,
    this.maxTokens = 4096,
    this.systemPrompt = kStealthFullSystemPrompt,
  }) : _client = client;

  final SupabaseClient _client;
  final String model;
  final int maxTokens;
  final String systemPrompt;

  /// Sends the full conversation (excluding the pending user message — pass it as [nextUserMessage]).
  /// [additionalSystemContext] is appended to the base Stealth prompt (e.g. customer + machine facts).
  /// [systemPromptOverride] replaces the default product KB prompt (e.g. lean onboarding chat).
  /// Anthropic expects **alternating** `user` / `assistant` turns. Merge consecutive
  /// same-role lines (e.g. validation retries) so the API does not return `messages` errors.
  static List<ChatTurn> _mergeAlternating(List<ChatTurn> turns) {
    final out = <ChatTurn>[];
    for (final t in turns) {
      if (t.text.trim().isEmpty) continue;
      if (out.isEmpty) {
        out.add(ChatTurn(role: t.role, text: t.text.trim()));
        continue;
      }
      final last = out.last;
      if (last.role == t.role) {
        out[out.length - 1] = ChatTurn(
          role: last.role,
          text: '${last.text}\n\n${t.text.trim()}',
        );
      } else {
        out.add(ChatTurn(role: t.role, text: t.text.trim()));
      }
    }
    return out;
  }

  static Map<String, dynamic> _userMessagePayload(String text, {List<String> imageUrls = const []}) {
    final content = <Map<String, dynamic>>[
      {'type': 'text', 'text': text},
    ];
    for (final url in imageUrls) {
      if (!url.startsWith('http')) continue;
      content.add({
        'type': 'image',
        'source': {'type': 'url', 'url': url},
      });
    }
    return {
      'role': 'user',
      'content': content,
    };
  }

  static Map<String, dynamic> _assistantMessagePayload(String text) {
    return {
      'role': 'assistant',
      'content': [
        {'type': 'text', 'text': text},
      ],
    };
  }

  /// Detailed variant that also returns the evidence citations returned by the
  /// edge function. Flutter screens that want a Sources accordion should call
  /// this instead of [complete].
  Future<ClaudeReply> completeDetailed({
    required List<ChatTurn> history,
    required String nextUserMessage,
    String additionalSystemContext = '',
    String? systemPromptOverride,
    String? sessionId,
    String? sessionChannel,
    bool includeRuntimeContext = false,
    List<String> nextUserImageUrls = const [],
  }) async {
    final raw = await _invoke(
      history: history,
      nextUserMessage: nextUserMessage,
      additionalSystemContext: additionalSystemContext,
      systemPromptOverride: systemPromptOverride,
      sessionId: sessionId,
      sessionChannel: sessionChannel,
      includeRuntimeContext: includeRuntimeContext,
      nextUserImageUrls: nextUserImageUrls,
    );
    return raw;
  }

  Future<String> complete({
    required List<ChatTurn> history,
    required String nextUserMessage,
    String additionalSystemContext = '',
    String? systemPromptOverride,
    String? sessionId,
    String? sessionChannel,
    bool includeRuntimeContext = false,
    List<String> nextUserImageUrls = const [],
  }) async {
    final reply = await _invoke(
      history: history,
      nextUserMessage: nextUserMessage,
      additionalSystemContext: additionalSystemContext,
      systemPromptOverride: systemPromptOverride,
      sessionId: sessionId,
      sessionChannel: sessionChannel,
      includeRuntimeContext: includeRuntimeContext,
      nextUserImageUrls: nextUserImageUrls,
    );
    return reply.text;
  }

  Future<ClaudeReply> _invoke({
    required List<ChatTurn> history,
    required String nextUserMessage,
    String additionalSystemContext = '',
    String? systemPromptOverride,
    String? sessionId,
    String? sessionChannel,
    bool includeRuntimeContext = false,
    List<String> nextUserImageUrls = const [],
  }) async {
    var merged = _mergeAlternating([
      ...history,
      ChatTurn(role: 'user', text: nextUserMessage),
    ]);
    // API requires the sequence to start with a `user` message.
    while (merged.isNotEmpty && merged.first.role == 'assistant') {
      merged = merged.sublist(1);
    }

    final messages = <Map<String, dynamic>>[];
    for (final turn in merged) {
      if (turn.role == 'assistant') {
        messages.add(_assistantMessagePayload(turn.text));
      } else {
        final isLast = identical(turn, merged.last) && turn.role == 'user';
        messages.add(_userMessagePayload(turn.text, imageUrls: isLast ? nextUserImageUrls : const []));
      }
    }

    if (messages.isEmpty) {
      messages.add(_userMessagePayload(nextUserMessage.trim(), imageUrls: nextUserImageUrls));
    }

    final base = systemPromptOverride ?? systemPrompt;
    final system = additionalSystemContext.trim().isEmpty
        ? base
        : '$base\n\n${additionalSystemContext.trim()}';

    try {
      final response = await _client.functions.invoke(
        'anthropic-chat',
        body: {
          'model': model,
          'max_tokens': maxTokens,
          'system': system,
          'messages': messages,
          'client': kIsWeb ? 'web' : 'native',
          if (includeRuntimeContext && sessionId != null && sessionChannel != null)
            'resolver': {
              'session_id': sessionId,
              'session_channel': sessionChannel,
              'include_runtime_context': true,
            },
        },
      );

      final data = response.data;
      if (response.status < 200 || response.status >= 300) {
        throw AnthropicApiException(
          _extractError(data) ?? 'Anthropic proxy failed with HTTP ${response.status}',
          statusCode: response.status,
        );
      }
      if (data is Map && data['text'] is String) {
        final text = data['text'] as String;
        final evidenceList = data['evidence'];
        final List<EvidenceCitation> evidence = [];
        if (evidenceList is List) {
          for (final e in evidenceList) {
            if (e is! Map) continue;
            evidence.add(EvidenceCitation(
              idx: (e['idx'] as num?)?.toInt() ?? evidence.length + 1,
              type: e['type']?.toString() ?? 'chunk',
              id: e['id']?.toString() ?? '',
              heading: e['heading']?.toString(),
              productSlug: e['product_slug']?.toString(),
              subsystem: e['subsystem']?.toString(),
              score: (e['score'] as num?)?.toDouble() ?? 0.0,
            ));
          }
        }
        final meta = data['resolver_meta'];
        final resolved = (meta is Map) ? meta['product_slug']?.toString() : null;
        final auditId = (meta is Map) ? meta['audit_id']?.toString() : null;
        return ClaudeReply(
          text: text,
          evidence: evidence,
          resolvedProduct: resolved,
          auditId: auditId,
        );
      }
      throw AnthropicApiException('Unexpected proxy response: missing `text`');
    } catch (e) {
      if (e is AnthropicApiException) rethrow;
      if (kDebugMode) {
        debugPrint('Anthropic proxy invoke error: $e');
      }
      throw AnthropicApiException(
        'Could not reach AI service proxy. Ensure Supabase Edge Function `anthropic-chat` '
        'is deployed and `ANTHROPIC_API_KEY` is set in Supabase secrets.',
      );
    }
  }

  /// Streaming variant of [complete] / [completeDetailed]. Yields incremental
  /// `delta` events as tokens arrive from Claude, then a final `done` event
  /// containing the full [ClaudeReply] (evidence + resolved product). This is
  /// the big UX-latency win: users see the first characters of the answer in
  /// ~500–800ms instead of waiting 5–10s for the whole reply.
  ///
  /// The network plumbing goes straight to the Edge Function URL (instead of
  /// `functions.invoke`) because the Supabase SDK buffers the full response.
  Stream<ClaudeStreamEvent> completeStream({
    required List<ChatTurn> history,
    required String nextUserMessage,
    String additionalSystemContext = '',
    String? systemPromptOverride,
    String? sessionId,
    String? sessionChannel,
    bool includeRuntimeContext = false,
    List<String> nextUserImageUrls = const [],
  }) async* {
    var merged = _mergeAlternating([
      ...history,
      ChatTurn(role: 'user', text: nextUserMessage),
    ]);
    while (merged.isNotEmpty && merged.first.role == 'assistant') {
      merged = merged.sublist(1);
    }

    final messages = <Map<String, dynamic>>[];
    for (final turn in merged) {
      if (turn.role == 'assistant') {
        messages.add(_assistantMessagePayload(turn.text));
      } else {
        final isLast = identical(turn, merged.last) && turn.role == 'user';
        messages.add(_userMessagePayload(turn.text, imageUrls: isLast ? nextUserImageUrls : const []));
      }
    }
    if (messages.isEmpty) {
      messages.add(_userMessagePayload(nextUserMessage.trim(), imageUrls: nextUserImageUrls));
    }

    final base = systemPromptOverride ?? systemPrompt;
    final system = additionalSystemContext.trim().isEmpty
        ? base
        : '$base\n\n${additionalSystemContext.trim()}';

    final url = '${EnvConfig.supabaseUrl}/functions/v1/anthropic-chat';
    final token =
        _client.auth.currentSession?.accessToken ?? EnvConfig.supabaseAnonKey;
    final req = http.Request('POST', Uri.parse(url));
    req.headers.addAll({
      'content-type': 'application/json',
      'accept': 'text/event-stream',
      'authorization': 'Bearer $token',
      'apikey': EnvConfig.supabaseAnonKey,
    });
    req.body = jsonEncode({
      'model': model,
      'max_tokens': maxTokens,
      'system': system,
      'messages': messages,
      'stream': true,
      'client': kIsWeb ? 'web' : 'native',
      if (includeRuntimeContext && sessionId != null && sessionChannel != null)
        'resolver': {
          'session_id': sessionId,
          'session_channel': sessionChannel,
          'include_runtime_context': true,
        },
    });

    final client = http.Client();
    http.StreamedResponse resp;
    try {
      resp = await client.send(req);
    } catch (e) {
      client.close();
      yield ClaudeStreamEvent.error(
        'Could not reach AI service proxy. Ensure Supabase Edge Function '
        '`anthropic-chat` is deployed and `ANTHROPIC_API_KEY` is set.',
      );
      return;
    }

    if (resp.statusCode < 200 || resp.statusCode >= 300) {
      final errBody = await resp.stream.bytesToString();
      client.close();
      yield ClaudeStreamEvent.error(
        'Anthropic proxy failed (HTTP ${resp.statusCode}): $errBody',
      );
      return;
    }

    final buffer = StringBuffer();
    final accText = StringBuffer();
    ClaudeReply? finalReply;
    String? streamError;

    try {
      await for (final chunk
          in resp.stream.transform(utf8.decoder)) {
        buffer.write(chunk);
        while (true) {
          final raw = buffer.toString();
          final idx = raw.indexOf('\n\n');
          if (idx < 0) break;
          final frame = raw.substring(0, idx);
          buffer
            ..clear()
            ..write(raw.substring(idx + 2));

          String? event;
          final dataLines = <String>[];
          for (final line in frame.split('\n')) {
            if (line.startsWith('event:')) {
              event = line.substring(6).trim();
            } else if (line.startsWith('data:')) {
              dataLines.add(line.substring(5).trim());
            }
          }
          if (dataLines.isEmpty) continue;
          final payload = dataLines.join('');
          Map<String, dynamic>? data;
          try {
            final decoded = jsonDecode(payload);
            if (decoded is Map<String, dynamic>) data = decoded;
          } catch (_) {
            continue;
          }
          if (data == null) continue;

          if (event == 'delta') {
            final t = data['text'];
            if (t is String && t.isNotEmpty) {
              accText.write(t);
              yield ClaudeStreamEvent.delta(t);
            }
          } else if (event == 'done') {
            final evidenceList = data['evidence'];
            final List<EvidenceCitation> evidence = [];
            if (evidenceList is List) {
              for (final e in evidenceList) {
                if (e is! Map) continue;
                evidence.add(EvidenceCitation(
                  idx: (e['idx'] as num?)?.toInt() ?? evidence.length + 1,
                  type: e['type']?.toString() ?? 'chunk',
                  id: e['id']?.toString() ?? '',
                  heading: e['heading']?.toString(),
                  productSlug: e['product_slug']?.toString(),
                  subsystem: e['subsystem']?.toString(),
                  score: (e['score'] as num?)?.toDouble() ?? 0.0,
                ));
              }
            }
            final meta = data['resolver_meta'];
            final resolved =
                (meta is Map) ? meta['product_slug']?.toString() : null;
            final auditId =
                (meta is Map) ? meta['audit_id']?.toString() : null;
            finalReply = ClaudeReply(
              text: accText.toString(),
              evidence: evidence,
              resolvedProduct: resolved,
              auditId: auditId,
            );
          } else if (event == 'error') {
            streamError = data['message']?.toString() ?? 'Unknown stream error';
          }
        }
      }
    } catch (e) {
      streamError = e.toString();
    } finally {
      client.close();
    }

    if (streamError != null && accText.isEmpty) {
      yield ClaudeStreamEvent.error(streamError);
      return;
    }
    yield ClaudeStreamEvent.done(
      finalReply ?? ClaudeReply(text: accText.toString()),
    );
  }

  void dispose() {}

  static String? _extractError(dynamic data) {
    if (data is Map) {
      final err = data['error'];
      if (err != null) return err.toString();
      final msg = data['message'];
      if (msg != null) return msg.toString();
    }
    if (data is String && data.isNotEmpty) return data;
    return null;
  }
}
