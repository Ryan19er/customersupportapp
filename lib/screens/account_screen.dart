import 'package:flutter/material.dart';

import '../config/bulletin_spec.dart';
import '../models/customer_profile.dart';
import '../services/chat_repository.dart';
import '../theme/stealth_theme.dart';

/// Profile, role, employee ID (bulletin §3), sign out, roadmap.
class AccountScreen extends StatefulWidget {
  const AccountScreen({
    super.key,
    required this.repository,
    required this.profile,
    this.onSignedOut,
  });

  final ChatRepository repository;
  final CustomerProfile profile;
  final VoidCallback? onSignedOut;

  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  static const _roles = ['customer', 'sales', 'technician', 'employee'];
  late String _role;
  final _employeeId = TextEditingController();
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final r = widget.profile.appRole ?? 'customer';
    _role = _roles.contains(r) ? r : 'customer';
    _employeeId.text = widget.profile.employeeId ?? '';
  }

  @override
  void dispose() {
    _employeeId.dispose();
    super.dispose();
  }

  Future<void> _saveEmployee() async {
    setState(() => _saving = true);
    try {
      await widget.repository.updateRoleAndEmployee(
        appRole: _role,
        employeeId: _employeeId.text.trim().isEmpty ? null : _employeeId.text.trim(),
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Saved')),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.profile;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Account'),
        backgroundColor: StealthColors.panelBlack,
        foregroundColor: StealthColors.mist,
      ),
      body: Container(
        decoration: const BoxDecoration(gradient: StealthGradients.chatBackdrop),
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              p.fullName ?? '—',
              style: const TextStyle(
                color: StealthColors.mist,
                fontSize: 22,
                fontWeight: FontWeight.bold,
              ),
            ),
            Text(
              p.phone ?? '',
              style: TextStyle(color: StealthColors.mist.withValues(alpha: 0.8)),
            ),
            const SizedBox(height: 16),
            _row('Machine', '${p.machineModel ?? '—'} · ${p.machineSerial ?? '—'}'),
            const Divider(color: Colors.white24),
            Text(
              'Role (bulletin: customer / sales / technician / employee)',
              style: TextStyle(
                color: StealthColors.mist.withValues(alpha: 0.85),
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              value: _role,
              dropdownColor: StealthColors.panelBlack,
              style: const TextStyle(color: StealthColors.mist),
              decoration: const InputDecoration(
                filled: true,
                fillColor: Color(0xFF252525),
              ),
              items: const [
                DropdownMenuItem(value: 'customer', child: Text('Customer')),
                DropdownMenuItem(value: 'sales', child: Text('Sales agent')),
                DropdownMenuItem(value: 'technician', child: Text('Technician')),
                DropdownMenuItem(value: 'employee', child: Text('Employee')),
              ],
              onChanged: (v) => setState(() => _role = v ?? 'customer'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _employeeId,
              style: const TextStyle(color: StealthColors.mist),
              decoration: InputDecoration(
                labelText: 'Employee ID (for internal capture)',
                labelStyle: TextStyle(color: StealthColors.mist.withValues(alpha: 0.7)),
                filled: true,
                fillColor: StealthColors.panelBlack.withValues(alpha: 0.85),
              ),
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: _saving ? null : _saveEmployee,
              style: FilledButton.styleFrom(backgroundColor: StealthColors.crimson),
              child: _saving
                  ? const SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Save role & employee ID'),
            ),
            const SizedBox(height: 24),
            Text(
              kBulletinAppTitle,
              style: TextStyle(
                color: StealthColors.mist.withValues(alpha: 0.85),
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            ...kBulletinCustomerPortalBullets.map(
              (b) => Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(
                  '• $b',
                  style: TextStyle(
                    color: StealthColors.mist.withValues(alpha: 0.65),
                    fontSize: 13,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 24),
            OutlinedButton.icon(
              onPressed: () async {
                await widget.repository.signOut();
                widget.onSignedOut?.call();
              },
              icon: const Icon(Icons.logout, color: StealthColors.crimson),
              label: const Text('Sign out', style: TextStyle(color: StealthColors.crimson)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _row(String k, String v) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Text(
              k,
              style: TextStyle(color: StealthColors.mist.withValues(alpha: 0.6)),
            ),
          ),
          Expanded(child: Text(v, style: const TextStyle(color: StealthColors.mist))),
        ],
      ),
    );
  }
}
