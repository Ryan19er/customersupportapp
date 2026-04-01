import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' show ClientException;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../config/bulletin_spec.dart';
import '../config/env_config.dart';
import '../services/anthropic_claude_service.dart';
import '../services/chat_repository.dart';
import '../services/contact_session_store.dart';
import '../theme/stealth_theme.dart';

/// Collects **name, email, phone** and saves chat to Supabase — no password, no login.
class PreAuthChatScreen extends StatefulWidget {
  const PreAuthChatScreen({super.key, required this.onFinished});

  /// Called after contact row + messages + intro are saved; argument is `chat_contacts.id`.
  final void Function(String contactId) onFinished;

  @override
  State<PreAuthChatScreen> createState() => _PreAuthChatScreenState();
}

class _LocalMsg {
  const _LocalMsg({required this.role, required this.content});
  final String role;
  final String content;
}

enum _Step { needAnything, needName, needEmail, needPhone }

class _PreAuthChatScreenState extends State<PreAuthChatScreen> {
  final _input = TextEditingController();
  final _inputFocus = FocusNode();
  final _scroll = ScrollController();

  final List<_LocalMsg> _messages = [];

  _Step _step = _Step.needAnything;
  String? _name;
  String? _phone;
  String? _email;

  bool _busy = false;
  bool _finishingAccount = false;
  String? _error;

  static String get _kAskName =>
      'Thanks for reaching out! What **name** should we use for your $kBulletinAppTitle support history?';

  static String get _kAskEmail =>
      'Got it. What **email** should we use so we can match this chat later?';

  static const _kAskEmailAgain =
      'That doesn\'t look like a valid email. Please send a working address (e.g. name@company.com).';

  static String get _kAskPhone =>
      'Thanks. What **phone number** can we use if we need to follow up?';

  static const _kAskPhoneAgain =
      'Please send a **phone number** with enough digits (include area code if applicable).';

  static const _kAskNameAgain = 'Please send at least **2 characters** for your name.';

  @override
  void dispose() {
    _input.dispose();
    _inputFocus.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _refocusInput() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _inputFocus.requestFocus();
    });
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.jumpTo(_scroll.position.maxScrollExtent);
    });
  }

  Widget _buildComposerField() {
    final decoration = InputDecoration(
      hintText: _hint(),
      hintStyle: TextStyle(color: StealthColors.mist.withValues(alpha: 0.45)),
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
    );

    return TextField(
      key: const ValueKey('pre_auth_composer_open'),
      controller: _input,
      focusNode: _inputFocus,
      autofocus: true,
      minLines: 1,
      maxLines: 5,
      keyboardType: _step == _Step.needEmail
          ? TextInputType.emailAddress
          : _step == _Step.needPhone
              ? TextInputType.phone
              : TextInputType.text,
      style: const TextStyle(color: StealthColors.mist),
      decoration: decoration,
      onSubmitted: (_) => _handleSend(),
    );
  }

  bool _looksLikeEmail(String s) {
    final t = s.trim();
    if (!t.contains('@') || t.length < 5) return false;
    final parts = t.split('@');
    if (parts.length != 2) return false;
    return parts[0].isNotEmpty && parts[1].isNotEmpty;
  }

  bool _looksLikePhone(String s) {
    final t = s.trim();
    if (t.length < 7) return false;
    final digits = RegExp(r'\d').allMatches(t).length;
    return digits >= 7;
  }

  List<ChatTurn> _claudeHistory() {
    return _messages
        .map((m) => ChatTurn(role: m.role, text: m.content))
        .toList();
  }

  Future<void> _finishOnboarding() async {
    if (_finishingAccount) return;
    _finishingAccount = true;
    try {
      _error = null;
      final claude = AnthropicClaudeService(
        client: Supabase.instance.client,
        model: EnvConfig.anthropicModel,
      );
      try {
        final client = Supabase.instance.client;
        final existingContactId = await ChatRepository.findExistingContactId(
          client: client,
          fullName: _name!.trim(),
          email: _email!.trim(),
          phone: _phone!.trim(),
        );
        final isReturningContact = existingContactId != null;
        final contactId = existingContactId ??
            await ChatRepository.createContact(
              client: client,
              fullName: _name!.trim(),
              email: _email!.trim(),
              phone: _phone!.trim(),
            );
        await ContactSessionStore.setContactId(contactId);

        final repo = ChatRepository(client, contactId: contactId);
        final profile = await repo.fetchProfile();
        if (profile == null) {
          throw StateError('Contact not found after save.');
        }

        final sid = await repo.getOrCreateSessionId();
        final priorMessages = await repo.loadMessages(sid);
        final hasPriorConversation = priorMessages.isNotEmpty;

        if (!hasPriorConversation) {
          for (final m in _messages) {
            await repo.insertChatMessage(
              sessionId: sid,
              role: m.role,
              content: m.content,
            );
          }
        }

        final intro = await claude.complete(
          history: hasPriorConversation
              ? priorMessages.map((m) => ChatTurn(role: m.role, text: m.content)).toList()
              : _claudeHistory(),
          nextUserMessage: hasPriorConversation
              ? 'The same customer just came back and matched their name, email, and phone with an existing record. Ask one short question about whether they want to continue the previous conversation, then offer next-step help.'
              : isReturningContact
                  ? 'A contact match was found but there is no saved conversation history. Welcome them back and ask what they need help with today.'
                  : 'I shared my name, email, and phone for support. Please welcome me briefly and ask what Stealth product I use and what I need help with today.',
          additionalSystemContext: profile.anthropicContextBlock,
        );
        await repo.insertChatMessage(
          sessionId: sid,
          role: 'assistant',
          content: intro,
        );

        if (!mounted) return;
        widget.onFinished(contactId);
      } catch (e, st) {
        debugPrint('PreAuthChatScreen error: $e');
        debugPrint('$st');
        if (e is ClientException) {
          debugPrint(
            'ClientException: ${e.message} uri=${e.uri}',
          );
        }
        if (mounted) {
          setState(() {
            final detail = kDebugMode ? '$e' : _friendlyClientError(e);
            _messages.add(
              _LocalMsg(role: 'assistant', content: 'Something went wrong: $detail'),
            );
            _busy = false;
          });
          _scrollToEnd();
        }
      } finally {
        claude.dispose();
      }
    } finally {
      _finishingAccount = false;
    }
  }

  Future<void> _handleSend() async {
    final text = _input.text.trim();
    if (text.isEmpty || _busy) return;
    _input.clear();

    setState(() {
      _messages.add(_LocalMsg(role: 'user', content: text));
      _busy = true;
      _error = null;
    });
    _scrollToEnd();

    try {
      switch (_step) {
        case _Step.needAnything:
          setState(() {
            _messages.add(_LocalMsg(role: 'assistant', content: _kAskName));
            _step = _Step.needName;
            _busy = false;
          });
          break;

        case _Step.needName:
          if (text.trim().length < 2) {
            setState(() {
              _messages.add(const _LocalMsg(role: 'assistant', content: _kAskNameAgain));
              _busy = false;
            });
          } else {
            _name = text.trim();
            setState(() {
              _messages.add(_LocalMsg(role: 'assistant', content: _kAskEmail));
              _step = _Step.needEmail;
              _busy = false;
            });
          }
          break;

        case _Step.needEmail:
          if (!_looksLikeEmail(text)) {
            setState(() {
              _messages.add(const _LocalMsg(role: 'assistant', content: _kAskEmailAgain));
              _busy = false;
            });
          } else {
            _email = text.trim();
            setState(() {
              _messages.add(_LocalMsg(role: 'assistant', content: _kAskPhone));
              _step = _Step.needPhone;
              _busy = false;
            });
          }
          break;

        case _Step.needPhone:
          if (!_looksLikePhone(text)) {
            setState(() {
              _messages.add(const _LocalMsg(role: 'assistant', content: _kAskPhoneAgain));
              _busy = false;
            });
          } else {
            _phone = text.trim();
            await _finishOnboarding();
          }
          break;
      }
    } finally {
      _scrollToEnd();
      _refocusInput();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Container(
          decoration: const BoxDecoration(gradient: StealthGradients.chatBackdrop),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 8, 4),
                child: Row(
                  children: [
                    Image.asset(
                      'assets/branding/stealthlaserlogo.png',
                      height: 40,
                      errorBuilder: (_, __, ___) => const SizedBox(height: 40),
                    ),
                    const Spacer(),
                    Text(
                      'Name · email · phone — no password',
                      style: TextStyle(
                        color: StealthColors.mist.withValues(alpha: 0.55),
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
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
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
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
                            color: user
                                ? Colors.white
                                : StealthColors.mist.withValues(alpha: 0.95),
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
                      Expanded(child: _buildComposerField()),
                      const SizedBox(width: 8),
                      FilledButton(
                        onPressed: _busy ? null : _handleSend,
                        style: FilledButton.styleFrom(
                          backgroundColor: StealthColors.crimson,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.all(14),
                          shape: const CircleBorder(),
                        ),
                        child: _busy
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

  String _hint() {
    switch (_step) {
      case _Step.needAnything:
        return 'Say anything to get started…';
      case _Step.needName:
        return 'Your name…';
      case _Step.needEmail:
        return 'Email address…';
      case _Step.needPhone:
        return 'Phone number…';
    }
  }

  /// Short user-facing hint in release; full `e` is shown in debug builds.
  static String _friendlyClientError(Object e) {
    if (e is ClientException) {
      return 'Network error (see Flutter console / Chrome DevTools for details). '
          'Check SUPABASE_URL and that the anon key is the JWT from '
          'Project Settings → API (legacy `eyJ…` format if the SDK rejects publishable keys).';
    }
    return e.toString();
  }
}
