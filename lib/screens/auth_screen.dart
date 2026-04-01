import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../services/auth_error_messages.dart';
import '../services/supabase_sign_up.dart';
import '../theme/stealth_theme.dart';

/// Email + password for **this app** (same credentials as chat onboarding).
class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _loading = false;
  bool _isSignUp = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    final email = _email.text.trim();
    final password = _password.text;
    try {
      if (_isSignUp) {
        final session = await signUpWithSession(
          client: Supabase.instance.client,
          email: email,
          password: password,
        );
        if (session == null) {
          setState(() => _error = 'Could not create your account. Try again.');
        }
      } else {
        await Supabase.instance.client.auth.signInWithPassword(
          email: email,
          password: password,
        );
      }
    } on AuthException catch (e) {
      setState(() => _error = friendlyAuthErrorMessage(e.message));
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(gradient: StealthGradients.chatBackdrop),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Image.asset(
                        'assets/branding/stealthlaserlogo.png',
                        height: 72,
                        errorBuilder: (_, __, ___) => const SizedBox(height: 72),
                      ),
                      const SizedBox(height: 24),
                      Text(
                        _isSignUp ? 'Create account' : 'Sign in',
                        style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                              color: StealthColors.mist,
                              fontWeight: FontWeight.w600,
                            ),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Stealth Machine Tools — support & training',
                        style: TextStyle(color: StealthColors.mist.withValues(alpha: 0.75)),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 28),
                      TextFormField(
                        controller: _email,
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const [AutofillHints.email],
                        style: const TextStyle(color: StealthColors.mist),
                        decoration: _fieldDecoration('Email'),
                        validator: (v) {
                          if (v == null || v.trim().isEmpty) return 'Enter email';
                          if (!v.contains('@')) return 'Enter a valid email';
                          return null;
                        },
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _password,
                        obscureText: true,
                        autofillHints: _isSignUp
                            ? const [AutofillHints.newPassword]
                            : const [AutofillHints.password],
                        style: const TextStyle(color: StealthColors.mist),
                        decoration: _fieldDecoration('Password'),
                        validator: (v) {
                          if (v == null || v.isEmpty) return 'Enter password';
                          if (v.length < 8) return 'At least 8 characters';
                          return null;
                        },
                      ),
                      if (_error != null) ...[
                        const SizedBox(height: 12),
                        Text(
                          _error!,
                          style: const TextStyle(color: StealthColors.crimson),
                        ),
                      ],
                      const SizedBox(height: 24),
                      FilledButton(
                        onPressed: _loading ? null : _submit,
                        style: FilledButton.styleFrom(
                          backgroundColor: StealthColors.crimson,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 16),
                        ),
                        child: _loading
                            ? const SizedBox(
                                height: 22,
                                width: 22,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : Text(_isSignUp ? 'Create account' : 'Sign in'),
                      ),
                      TextButton(
                        onPressed: _loading
                            ? null
                            : () => setState(() {
                                  _isSignUp = !_isSignUp;
                                  _error = null;
                                }),
                        child: Text(
                          _isSignUp
                              ? 'Already have an account? Sign in'
                              : 'Need an account? Sign up',
                          style: const TextStyle(color: StealthColors.mist),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  InputDecoration _fieldDecoration(String label) {
    return InputDecoration(
      labelText: label,
      labelStyle: TextStyle(color: StealthColors.mist.withValues(alpha: 0.8)),
      enabledBorder: OutlineInputBorder(
        borderSide: BorderSide(color: StealthColors.mist.withValues(alpha: 0.35)),
      ),
      focusedBorder: const OutlineInputBorder(
        borderSide: BorderSide(color: StealthColors.crimson),
      ),
      filled: true,
      fillColor: StealthColors.panelBlack.withValues(alpha: 0.85),
    );
  }
}
