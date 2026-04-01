import 'package:flutter/material.dart';

import '../models/customer_profile.dart';
import '../services/chat_repository.dart';
import '../theme/stealth_theme.dart';

/// Captures customer + machine identity for support context (stored in Supabase `profiles`).
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({
    super.key,
    required this.repository,
    required this.profile,
    required this.onCompleted,
  });

  final ChatRepository repository;
  final CustomerProfile profile;
  final VoidCallback onCompleted;

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _company = TextEditingController();
  final _model = TextEditingController();
  final _serial = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _name.text = widget.profile.fullName ?? '';
    _phone.text = widget.profile.phone ?? '';
    _company.text = widget.profile.companyName ?? '';
    _model.text = widget.profile.machineModel ?? '';
    _serial.text = widget.profile.machineSerial ?? '';
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _company.dispose();
    _model.dispose();
    _serial.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await widget.repository.completeOnboarding(
        fullName: _name.text.trim(),
        phone: _phone.text.trim(),
        companyName:
            _company.text.trim().isEmpty ? null : _company.text.trim(),
        machineModel: _model.text.trim(),
        machineSerial: _serial.text.trim(),
      );
      widget.onCompleted();
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
                constraints: const BoxConstraints(maxWidth: 480),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        'Your equipment profile',
                        style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                              color: StealthColors.mist,
                              fontWeight: FontWeight.w600,
                            ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'We use this to personalize support and remember you on return visits.',
                        style: TextStyle(color: StealthColors.mist.withValues(alpha: 0.75)),
                      ),
                      const SizedBox(height: 24),
                      _field('Full name', _name, required: true),
                      const SizedBox(height: 12),
                      _field('Phone', _phone, required: true, phone: true),
                      const SizedBox(height: 12),
                      _field('Company (optional)', _company),
                      const SizedBox(height: 12),
                      _field('Machine model', _model, required: true),
                      const SizedBox(height: 12),
                      _field('Serial number', _serial, required: true),
                      if (_error != null) ...[
                        const SizedBox(height: 12),
                        Text(_error!, style: const TextStyle(color: StealthColors.crimson)),
                      ],
                      const SizedBox(height: 24),
                      FilledButton(
                        onPressed: _loading ? null : _save,
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
                            : const Text('Continue to support chat'),
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

  Widget _field(
    String label,
    TextEditingController c, {
    bool required = false,
    bool phone = false,
  }) {
    return TextFormField(
      controller: c,
      keyboardType: phone ? TextInputType.phone : TextInputType.text,
      style: const TextStyle(color: StealthColors.mist),
      decoration: InputDecoration(
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
      ),
      validator: (v) {
        if (!required) return null;
        if (v == null || v.trim().isEmpty) return 'Required';
        return null;
      },
    );
  }
}
