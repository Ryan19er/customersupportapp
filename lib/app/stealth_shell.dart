import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/customer_profile.dart';
import '../services/chat_repository.dart';
import '../services/contact_session_store.dart';
import 'stealth_main_shell.dart';
import '../screens/auth_screen.dart';
import '../screens/onboarding_screen.dart';
import '../screens/pre_auth_chat_screen.dart';
import '../theme/stealth_theme.dart';

/// AI onboarding → main shell. Uses a **saved contact id** on device (no password / login).
class StealthShell extends StatefulWidget {
  const StealthShell({super.key});

  @override
  State<StealthShell> createState() => _StealthShellState();
}

class _StealthShellState extends State<StealthShell> {
  String? _contactId;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final id = await ContactSessionStore.getContactId();
    if (!mounted) return;
    setState(() {
      _contactId = id;
      _loading = false;
    });
  }

  void _onPreAuthFinished(String contactId) {
    setState(() => _contactId = contactId);
  }

  void _onSessionCleared() {
    setState(() => _contactId = null);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    final client = Supabase.instance.client;

    if (_contactId == null) {
      return PreAuthChatScreen(onFinished: _onPreAuthFinished);
    }

    final repository = ChatRepository(client, contactId: _contactId);
    return _SignedInRouter(
      repository: repository,
      onSessionCleared: _onSessionCleared,
    );
  }
}

class _SignedInRouter extends StatefulWidget {
  const _SignedInRouter({
    required this.repository,
    required this.onSessionCleared,
  });

  final ChatRepository repository;
  final VoidCallback onSessionCleared;

  @override
  State<_SignedInRouter> createState() => _SignedInRouterState();
}

class _SignedInRouterState extends State<_SignedInRouter> {
  CustomerProfile? _profile;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() => _loading = true);
    final p = await widget.repository.fetchProfile();
    if (!mounted) return;
    setState(() {
      _profile = p;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }
    final p = _profile;
    if (p == null) {
      return Scaffold(
        body: Container(
          decoration: const BoxDecoration(gradient: StealthGradients.chatBackdrop),
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Text(
                    'Could not load your saved profile. Run migration 004 in Supabase '
                    '(supabase/migrations/004_support_chat_no_auth.sql) or try again.',
                    style: TextStyle(color: StealthColors.mist),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 16),
                  TextButton(
                    onPressed: () {
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (context) => const AuthScreen(),
                        ),
                      );
                    },
                    child: const Text('Sign in', style: TextStyle(color: StealthColors.mist)),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    }
    if (!p.isOnboardingComplete) {
      return OnboardingScreen(
        repository: widget.repository,
        profile: p,
        onCompleted: _refresh,
      );
    }
    return StealthMainShell(
      repository: widget.repository,
      profile: p,
      onSessionCleared: widget.onSessionCleared,
    );
  }
}
