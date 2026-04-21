import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config/env_config.dart';
import '../models/customer_profile.dart';
import '../models/stored_chat_message.dart';
import '../services/anthropic_claude_service.dart';
import '../services/chat_repository.dart';
import '../theme/stealth_theme.dart';

/// Loads persisted messages and continues the same thread after the user opens the app signed in.
class ChatScreen extends StatefulWidget {
  const ChatScreen({
    super.key,
    required this.repository,
    required this.profile,
    /// When true (main app shell), no AppBar — navigation & sign-out live elsewhere.
    this.embedded = false,
    this.onSignedOut,
  });

  final ChatRepository repository;
  final CustomerProfile profile;
  final bool embedded;
  final VoidCallback? onSignedOut;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  late final AnthropicClaudeService _claude = AnthropicClaudeService(
    client: Supabase.instance.client,
    model: EnvConfig.anthropicModel,
  );

  final _input = TextEditingController();
  final _inputFocus = FocusNode();
  final _scroll = ScrollController();
  String? _sessionId;
  List<StoredChatMessage> _messages = [];
  // Keep historical messages in storage for AI context, but do not render
  // the full prior transcript for returning users.
  int _displayStartIndex = 0;
  bool _loadingThread = true;
  bool _sending = false;
  String? _error;
  // Live streaming buffer: shown in place of the "typing..." bubble so the
  // user sees the reply being written in real-time (~500ms to first token).
  String _streamingAssistant = '';
  // Evidence for the most-recent assistant reply, rendered as an accordion.
  List<EvidenceCitation> _lastEvidence = const [];
  String? _lastResolvedProduct;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  @override
  void dispose() {
    _input.dispose();
    _inputFocus.dispose();
    _scroll.dispose();
    _claude.dispose();
    super.dispose();
  }

  void _refocusInput() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _inputFocus.requestFocus();
    });
  }

  Future<void> _bootstrap() async {
    try {
      String? sid;
      List<StoredChatMessage> msgs = [];
      // After sign-up, pre-auth chat may still be persisting messages; retry briefly.
      for (var attempt = 0; attempt < 12; attempt++) {
        sid = await widget.repository.getOrCreateSessionId();
        msgs = await widget.repository.loadMessages(sid);
        if (msgs.isNotEmpty || attempt >= 11) break;
        await Future<void>.delayed(const Duration(milliseconds: 120));
      }
      if (!mounted) return;
      setState(() {
        _sessionId = sid;
        _displayStartIndex = msgs.length;
        _messages = const [];
        _loadingThread = false;
      });
      _scrollToEnd();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loadingThread = false;
      });
    }
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.jumpTo(_scroll.position.maxScrollExtent);
    });
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _sessionId == null || _sending) return;
    final startedAt = DateTime.now();

    setState(() {
      _sending = true;
      _streamingAssistant = '';
      _error = null;
    });
    _input.clear();
    _scrollToEnd();

    try {
      ClaudeReply? lastReply;
      await widget.repository.appendExchange(
        sessionId: _sessionId!,
        userText: text,
        getAssistant: (prior, userMsg) async {
          final history = prior
              .map(
                (m) => ChatTurn(role: m.role, text: m.content),
              )
              .toList();
          // Consume the SSE stream: update the UI buffer for every delta so
          // the user sees tokens appear as Claude produces them. The final
          // `done` event carries the accumulated text + evidence metadata.
          final buf = StringBuffer();
          await for (final evt in _claude.completeStream(
            history: history,
            nextUserMessage: userMsg,
            additionalSystemContext: widget.profile.anthropicContextBlock,
            sessionId: _sessionId,
            sessionChannel: widget.repository.sessionChannel,
            includeRuntimeContext: true,
          )) {
            switch (evt.kind) {
              case ClaudeStreamEventKind.delta:
                buf.write(evt.text);
                if (!mounted) break;
                setState(() => _streamingAssistant = buf.toString());
                _scrollToEnd();
                break;
              case ClaudeStreamEventKind.done:
                lastReply = evt.reply;
                break;
              case ClaudeStreamEventKind.error:
                throw Exception(evt.error ?? 'Stream failed');
            }
          }
          return (lastReply?.text ?? buf.toString()).trim();
        },
      );
      if (lastReply != null) {
        _lastEvidence = lastReply!.evidence;
        _lastResolvedProduct = lastReply!.resolvedProduct;
      }
      final fresh = await widget.repository.loadMessages(_sessionId!);
      final start = _displayStartIndex.clamp(0, fresh.length);
      if (!mounted) return;
      setState(() {
        _messages = fresh.sublist(start);
        _streamingAssistant = '';
      });
      _scrollToEnd();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _streamingAssistant = '';
      });
    } finally {
      if (mounted) setState(() => _sending = false);
      _refocusInput();
    }
  }

  Future<void> _signOut() async {
    await widget.repository.signOut();
    widget.onSignedOut?.call();
  }

  @override
  Widget build(BuildContext context) {
    if (_loadingThread) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    return Scaffold(
      appBar: widget.embedded
          ? null
          : AppBar(
              flexibleSpace: Container(
                decoration: const BoxDecoration(gradient: StealthGradients.appBar),
              ),
              title: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Stealth Support'),
                  Text(
                    '${widget.profile.machineModel ?? '—'} · ${widget.profile.fullName ?? ''}',
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.normal),
                  ),
                ],
              ),
              actions: [
                IconButton(
                  tooltip: 'Sign out',
                  onPressed: _signOut,
                  icon: const Icon(Icons.logout),
                ),
              ],
            ),
      body: SafeArea(
        top: true,
        bottom: false,
        child: Container(
          decoration: const BoxDecoration(gradient: StealthGradients.chatBackdrop),
          child: Column(
            children: [
            if (_error != null)
              Material(
                color: StealthColors.panelBlack.withValues(alpha: 0.9),
                child: ListTile(
                  leading: const Icon(Icons.warning_amber, color: StealthColors.crimson),
                  title: Text(
                    _error!,
                    style: const TextStyle(color: StealthColors.mist, fontSize: 13),
                  ),
                ),
              ),
            Expanded(
              child: ListView.builder(
                controller: _scroll,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                itemCount: _messages.length + (_sending ? 1 : 0),
                itemBuilder: (context, i) {
                  if (_sending && i == _messages.length) {
                    final streaming = _streamingAssistant.isNotEmpty;
                    return Align(
                      alignment: Alignment.centerLeft,
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 10),
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        constraints: BoxConstraints(
                          maxWidth: MediaQuery.sizeOf(context).width * 0.88,
                        ),
                        decoration: BoxDecoration(
                          gradient: StealthGradients.assistantBubble,
                          borderRadius: BorderRadius.circular(14).copyWith(
                            bottomLeft: const Radius.circular(4),
                          ),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.35),
                              blurRadius: 8,
                              offset: const Offset(0, 2),
                            ),
                          ],
                        ),
                        child: streaming
                            ? _AssistantRichText(
                                text: _streamingAssistant,
                                color: StealthColors.mist.withValues(alpha: 0.95),
                              )
                            : Text(
                                'Stealth Support is typing...',
                                style: TextStyle(
                                  color:
                                      StealthColors.mist.withValues(alpha: 0.9),
                                  fontStyle: FontStyle.italic,
                                  height: 1.35,
                                ),
                              ),
                      ),
                    );
                  }
                  final m = _messages[i];
                  final user = m.role == 'user';
                  return Align(
                    alignment: user ? Alignment.centerRight : Alignment.centerLeft,
                    child: Container(
                      margin: const EdgeInsets.only(bottom: 10),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                      constraints: BoxConstraints(
                        maxWidth: MediaQuery.sizeOf(context).width * 0.88,
                      ),
                      decoration: BoxDecoration(
                        gradient: user
                            ? StealthGradients.userBubble
                            : StealthGradients.assistantBubble,
                        borderRadius: BorderRadius.circular(14).copyWith(
                          bottomRight: user ? const Radius.circular(4) : null,
                          bottomLeft: user ? null : const Radius.circular(4),
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.35),
                            blurRadius: 8,
                            offset: const Offset(0, 2),
                          ),
                        ],
                      ),
                      child: user
                          ? SelectableText(
                              m.content,
                              style: const TextStyle(
                                color: Colors.white,
                                height: 1.35,
                              ),
                              contextMenuBuilder: (context, editableTextState) {
                                return AdaptiveTextSelectionToolbar.editableText(
                                  editableTextState: editableTextState,
                                );
                              },
                            )
                          : _AssistantRichText(
                              text: m.content,
                              color: StealthColors.mist
                                  .withValues(alpha: 0.95),
                            ),
                    ),
                  );
                },
              ),
            ),
            if (_lastEvidence.isNotEmpty)
              _SourcesAccordion(
                evidence: _lastEvidence,
                resolvedProduct: _lastResolvedProduct,
              ),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                child: Row(
                  children: [
                    Expanded(
                      // Plain Enter = send. Shift+Enter inserts a newline.
                      // Needed because Flutter Web treats Enter in a multi-
                      // line TextField as a newline by default.
                      child: CallbackShortcuts(
                        bindings: <ShortcutActivator, VoidCallback>{
                          const SingleActivator(LogicalKeyboardKey.enter): () {
                            if (!_sending) _send();
                          },
                          const SingleActivator(LogicalKeyboardKey.numpadEnter): () {
                            if (!_sending) _send();
                          },
                        },
                      child: TextField(
                        controller: _input,
                        focusNode: _inputFocus,
                        autofocus: true,
                        minLines: 1,
                        maxLines: 5,
                        textInputAction: TextInputAction.send,
                        style: const TextStyle(color: StealthColors.mist),
                        decoration: InputDecoration(
                          hintText: _sending ? 'Waiting for Claude…' : 'Ask about your Stealth machine… (Enter to send, Shift+Enter for newline)',
                          hintStyle: TextStyle(
                            color: StealthColors.mist.withValues(alpha: 0.45),
                          ),
                          filled: true,
                          fillColor: StealthColors.panelBlack.withValues(alpha: 0.92),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(14),
                            borderSide: BorderSide(
                              color: StealthColors.mist.withValues(alpha: 0.2),
                            ),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(14),
                            borderSide: const BorderSide(color: StealthColors.crimson),
                          ),
                        ),
                        onSubmitted: (_) => _send(),
                      ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    FilledButton(
                      onPressed: _sending ? null : _send,
                      style: FilledButton.styleFrom(
                        backgroundColor: StealthColors.crimson,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.all(14),
                        shape: const CircleBorder(),
                      ),
                      child: _sending
                          ? const SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.send),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
        ),
      ),
    );
  }
}

class _SourcesAccordion extends StatefulWidget {
  const _SourcesAccordion({required this.evidence, required this.resolvedProduct});
  final List<EvidenceCitation> evidence;
  final String? resolvedProduct;

  @override
  State<_SourcesAccordion> createState() => _SourcesAccordionState();
}

class _SourcesAccordionState extends State<_SourcesAccordion> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final count = widget.evidence.length;
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      decoration: BoxDecoration(
        color: StealthColors.panelBlack.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: StealthColors.mist.withValues(alpha: 0.15)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: () => setState(() => _open = !_open),
            borderRadius: BorderRadius.circular(10),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                children: [
                  Icon(
                    _open ? Icons.expand_less : Icons.expand_more,
                    size: 18,
                    color: StealthColors.mist.withValues(alpha: 0.8),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      widget.resolvedProduct == null
                          ? 'Sources used ($count)'
                          : 'Sources used ($count · ${widget.resolvedProduct})',
                      style: TextStyle(
                        color: StealthColors.mist.withValues(alpha: 0.85),
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (_open)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final e in widget.evidence)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Text(
                        '[E${e.idx}] ${e.type} · ${e.productSlug ?? "general"}'
                        '${e.subsystem != null ? " · ${e.subsystem}" : ""}'
                        '${e.heading != null ? " · ${e.heading}" : ""}'
                        ' · score ${e.score.toStringAsFixed(2)}',
                        style: TextStyle(
                          color: StealthColors.mist.withValues(alpha: 0.7),
                          fontSize: 11.5,
                          height: 1.3,
                        ),
                      ),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Renders assistant text with tappable links. Recognizes two patterns:
///   1. Markdown links: [visible title](https://example.com/file.pdf)
///   2. Bare URLs:      https://example.com/file.pdf
/// Every other character is rendered as-is. Used for both streamed and
/// stored assistant bubbles so customers can tap on a manual link and open
/// it directly on their phone (replaces the old Guides/Training tabs).
class _AssistantRichText extends StatefulWidget {
  const _AssistantRichText({required this.text, required this.color});
  final String text;
  final Color color;

  @override
  State<_AssistantRichText> createState() => _AssistantRichTextState();
}

class _AssistantRichTextState extends State<_AssistantRichText> {
  final List<TapGestureRecognizer> _recognizers = [];

  @override
  void dispose() {
    for (final r in _recognizers) {
      r.dispose();
    }
    super.dispose();
  }

  Future<void> _open(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  // Markdown link: [title](url). Only accepts http(s) URLs so we don't
  // launch arbitrary schemes from AI output.
  static final _mdLink = RegExp(
    r'\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)',
  );
  // Bare URL: http(s)://...   — stops at whitespace / markdown-closing chars.
  static final _bareUrl = RegExp(r'(https?:\/\/[^\s)\]\}]+)');

  List<TextSpan> _buildSpans(TextStyle baseStyle, TextStyle linkStyle) {
    for (final r in _recognizers) {
      r.dispose();
    }
    _recognizers.clear();

    final spans = <TextSpan>[];
    final text = widget.text;
    if (text.isEmpty) return spans;

    // Pass 1: markdown links. Anything between matches is passed to pass 2.
    int cursor = 0;
    final mdMatches = _mdLink.allMatches(text).toList();
    for (final m in mdMatches) {
      if (m.start > cursor) {
        spans.addAll(_splitBareUrls(text.substring(cursor, m.start), baseStyle, linkStyle));
      }
      final label = m.group(1)!;
      final url = m.group(2)!;
      final recognizer = TapGestureRecognizer()..onTap = () => _open(url);
      _recognizers.add(recognizer);
      spans.add(TextSpan(text: label, style: linkStyle, recognizer: recognizer));
      cursor = m.end;
    }
    if (cursor < text.length) {
      spans.addAll(_splitBareUrls(text.substring(cursor), baseStyle, linkStyle));
    }
    return spans;
  }

  List<TextSpan> _splitBareUrls(
    String input,
    TextStyle baseStyle,
    TextStyle linkStyle,
  ) {
    final out = <TextSpan>[];
    int cursor = 0;
    for (final m in _bareUrl.allMatches(input)) {
      if (m.start > cursor) {
        out.add(TextSpan(text: input.substring(cursor, m.start), style: baseStyle));
      }
      final url = m.group(1)!;
      final recognizer = TapGestureRecognizer()..onTap = () => _open(url);
      _recognizers.add(recognizer);
      out.add(TextSpan(text: url, style: linkStyle, recognizer: recognizer));
      cursor = m.end;
    }
    if (cursor < input.length) {
      out.add(TextSpan(text: input.substring(cursor), style: baseStyle));
    }
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final baseStyle = TextStyle(color: widget.color, height: 1.35);
    final linkStyle = TextStyle(
      color: StealthColors.crimson,
      height: 1.35,
      decoration: TextDecoration.underline,
      decorationColor: StealthColors.crimson,
      fontWeight: FontWeight.w600,
    );
    final spans = _buildSpans(baseStyle, linkStyle);
    if (spans.isEmpty) {
      return Text(widget.text, style: baseStyle);
    }
    return SelectableText.rich(
      TextSpan(style: baseStyle, children: spans),
      contextMenuBuilder: (context, editableTextState) {
        return AdaptiveTextSelectionToolbar.editableText(
          editableTextState: editableTextState,
        );
      },
    );
  }
}
