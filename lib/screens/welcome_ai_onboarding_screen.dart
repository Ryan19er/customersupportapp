import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../config/bulletin_spec.dart';
import '../services/chat_repository.dart';
import '../services/auth_error_messages.dart';
import '../services/supabase_sign_up.dart';
import '../theme/stealth_theme.dart';
import 'auth_screen.dart';

/// Bulletin flow: AI-led welcome → profile & machine → app account (email/password) + profile.
/// No standalone login screen first — "Sign in" is secondary.
class WelcomeAiOnboardingScreen extends StatefulWidget {
  const WelcomeAiOnboardingScreen({super.key});

  @override
  State<WelcomeAiOnboardingScreen> createState() =>
      _WelcomeAiOnboardingScreenState();
}

class _WelcomeAiOnboardingScreenState extends State<WelcomeAiOnboardingScreen> {
  int _step = 0;

  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _company = TextEditingController();
  final _model = TextEditingController();
  final _serial = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _password2 = TextEditingController();

  final _formKey = GlobalKey<FormState>();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _company.dispose();
    _model.dispose();
    _serial.dispose();
    _email.dispose();
    _password.dispose();
    _password2.dispose();
    super.dispose();
  }

  Future<void> _submitAccount() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final session = await signUpWithSession(
        client: Supabase.instance.client,
        email: _email.text.trim(),
        password: _password.text,
      );
      if (session == null) {
        if (!mounted) return;
        setState(() {
          _error = 'Could not create your account. Try again.';
          _loading = false;
        });
        return;
      }
      final repo = ChatRepository(Supabase.instance.client);
      await repo.completeOnboarding(
        fullName: _name.text.trim(),
        phone: _phone.text.trim(),
        companyName: _company.text.trim().isEmpty
            ? null
            : _company.text.trim(),
        machineModel: _model.text.trim(),
        machineSerial: _serial.text.trim(),
      );
    } on AuthException catch (e) {
      setState(() => _error = friendlyAuthErrorMessage(e.message));
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _openSignInOnly() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (context) => const AuthScreen(),
      ),
    );
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
                constraints: const BoxConstraints(maxWidth: 520),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Image.asset(
                        'assets/branding/stealthlaserlogo.png',
                        height: 64,
                        errorBuilder: (_, __, ___) =>
                            const SizedBox(height: 64),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        kBulletinAppTitle,
                        textAlign: TextAlign.center,
                        style:
                            Theme.of(context).textTheme.titleLarge?.copyWith(
                                  color: StealthColors.mist,
                                  fontWeight: FontWeight.bold,
                                ),
                      ),
                      const SizedBox(height: 20),
                      if (_step == 0) ...[
                        _assistantBubble(kAiOnboardingIntro),
                        const SizedBox(height: 8),
                        ...kBulletinCustomerPortalBullets.map(
                          (b) => Padding(
                            padding: const EdgeInsets.only(bottom: 6),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('• ',
                                    style: TextStyle(color: StealthColors.mist)),
                                Expanded(
                                  child: Text(
                                    b,
                                    style: TextStyle(
                                      color: StealthColors.mist
                                          .withValues(alpha: 0.85),
                                      height: 1.35,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 20),
                        FilledButton(
                          onPressed: () => setState(() => _step = 1),
                          style: FilledButton.styleFrom(
                            backgroundColor: StealthColors.crimson,
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(vertical: 16),
                          ),
                          child: const Text('Start onboarding'),
                        ),
                        TextButton(
                          onPressed: _openSignInOnly,
                          child: const Text(
                            'Already have an account? Sign in',
                            style: TextStyle(color: StealthColors.mist),
                          ),
                        ),
                      ],
                      if (_step == 1) ...[
                        _assistantBubble(
                          'Great. Enter your contact details and your Stealth machine model and serial number so we can personalize support.',
                        ),
                        const SizedBox(height: 20),
                        _field('Full name', _name, required: true),
                        const SizedBox(height: 12),
                        _field('Phone', _phone, required: true, phone: true),
                        const SizedBox(height: 12),
                        _field('Company (optional)', _company),
                        const SizedBox(height: 12),
                        _field('Machine model', _model, required: true),
                        const SizedBox(height: 12),
                        _field('Serial number', _serial, required: true),
                        const SizedBox(height: 20),
                        Row(
                          children: [
                            TextButton(
                              onPressed: () => setState(() => _step = 0),
                              child: const Text('Back',
                                  style: TextStyle(color: StealthColors.mist)),
                            ),
                            const Spacer(),
                            FilledButton(
                              onPressed: () {
                                if (_formKey.currentState!.validate()) {
                                  setState(() => _step = 2);
                                }
                              },
                              style: FilledButton.styleFrom(
                                backgroundColor: StealthColors.crimson,
                                foregroundColor: Colors.white,
                              ),
                              child: const Text('Next'),
                            ),
                          ],
                        ),
                      ],
                      if (_step == 2) ...[
                        _assistantBubble(
                          'Last step: create your secure account. We use this to remember your machine, tickets, and chat history.',
                        ),
                        const SizedBox(height: 20),
                        _field('Email', _email, required: true, email: true),
                        const SizedBox(height: 12),
                        _field('Password', _password, required: true, obscure: true),
                        const SizedBox(height: 12),
                        _field(
                          'Confirm password',
                          _password2,
                          required: true,
                          obscure: true,
                          confirmMatches: _password,
                        ),
                        if (_error != null) ...[
                          const SizedBox(height: 12),
                          Text(_error!,
                              style: const TextStyle(
                                  color: StealthColors.crimson)),
                        ],
                        const SizedBox(height: 20),
                        Row(
                          children: [
                            TextButton(
                              onPressed: () => setState(() => _step = 1),
                              child: const Text('Back',
                                  style: TextStyle(color: StealthColors.mist)),
                            ),
                            const Spacer(),
                            FilledButton(
                              onPressed: _loading ? null : _submitAccount,
                              style: FilledButton.styleFrom(
                                backgroundColor: StealthColors.crimson,
                                foregroundColor: Colors.white,
                              ),
                              child: _loading
                                  ? const SizedBox(
                                      width: 22,
                                      height: 22,
                                      child: CircularProgressIndicator(
                                          strokeWidth: 2),
                                    )
                                  : const Text('Create account & continue'),
                            ),
                          ],
                        ),
                      ],
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

  Widget _assistantBubble(String text) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: StealthGradients.assistantBubble,
        borderRadius: BorderRadius.circular(14),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.35),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Text(
        text.trim(),
        style: TextStyle(
          color: StealthColors.mist.withValues(alpha: 0.95),
          height: 1.45,
        ),
      ),
    );
  }

  Widget _field(
    String label,
    TextEditingController c, {
    bool required = false,
    bool phone = false,
    bool email = false,
    bool obscure = false,
    TextEditingController? confirmMatches,
  }) {
    return TextFormField(
      controller: c,
      obscureText: obscure,
      keyboardType: email
          ? TextInputType.emailAddress
          : phone
              ? TextInputType.phone
              : TextInputType.text,
      style: const TextStyle(color: StealthColors.mist),
      decoration: InputDecoration(
        labelText: label,
        labelStyle:
            TextStyle(color: StealthColors.mist.withValues(alpha: 0.8)),
        enabledBorder: OutlineInputBorder(
          borderSide: BorderSide(
              color: StealthColors.mist.withValues(alpha: 0.35)),
        ),
        focusedBorder: const OutlineInputBorder(
          borderSide: BorderSide(color: StealthColors.crimson),
        ),
        filled: true,
        fillColor: StealthColors.panelBlack.withValues(alpha: 0.85),
      ),
      validator: (v) {
        if (!required) return null;
        if (v == null || v.trim().isEmpty) return 'Required';
        if (email && !v.contains('@')) return 'Valid email required';
        if (confirmMatches != null && v != confirmMatches.text) {
          return 'Passwords do not match';
        }
        if (obscure && confirmMatches == null && (v.length < 8)) {
          return 'At least 8 characters';
        }
        return null;
      },
    );
  }
}
