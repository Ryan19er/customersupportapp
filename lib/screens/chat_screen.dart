import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

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
  bool _loadingThread = true;
  bool _sending = false;
  String? _error;

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
        _messages = msgs;
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

    setState(() {
      _sending = true;
      _error = null;
    });
    _input.clear();

    try {
      await widget.repository.appendExchange(
        sessionId: _sessionId!,
        userText: text,
        getAssistant: (prior, userMsg) async {
          final history = prior
              .map(
                (m) => ChatTurn(role: m.role, text: m.content),
              )
              .toList();
          return _claude.complete(
            history: history,
            nextUserMessage: userMsg,
            additionalSystemContext: widget.profile.anthropicContextBlock,
          );
        },
      );
      final fresh = await widget.repository.loadMessages(_sessionId!);
      if (!mounted) return;
      setState(() => _messages = fresh);
      _scrollToEnd();
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
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
                itemCount: _messages.length,
                itemBuilder: (context, i) {
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
                      child: Text(
                        m.content,
                        style: TextStyle(
                          color: user ? Colors.white : StealthColors.mist.withValues(alpha: 0.95),
                          height: 1.35,
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _input,
                        focusNode: _inputFocus,
                        autofocus: true,
                        minLines: 1,
                        maxLines: 5,
                        style: const TextStyle(color: StealthColors.mist),
                        decoration: InputDecoration(
                          hintText: _sending ? 'Waiting for Claude…' : 'Ask about your Stealth machine…',
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
