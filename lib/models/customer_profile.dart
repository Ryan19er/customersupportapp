/// Customer row from `public.profiles` (tied to the signed-in app user).
class CustomerProfile {
  const CustomerProfile({
    required this.id,
    this.fullName,
    this.contactEmail,
    this.phone,
    this.companyName,
    this.machineModel,
    this.machineSerial,
    this.onboardingCompletedAt,
    this.appRole,
    this.employeeId,
  });

  final String id;
  final String? fullName;
  /// Email collected in-app (e.g. anonymous sessions — not always auth.users.email).
  final String? contactEmail;
  final String? phone;
  final String? companyName;
  final String? machineModel;
  final String? machineSerial;
  final DateTime? onboardingCompletedAt;
  /// customer | sales | technician | employee (bulletin: role-based UX)
  final String? appRole;
  final String? employeeId;

  bool get isOnboardingComplete => onboardingCompletedAt != null;

  factory CustomerProfile.fromMap(Map<String, dynamic> row) {
    return CustomerProfile(
      id: row['id'] as String,
      fullName: row['full_name'] as String?,
      contactEmail: row['contact_email'] as String?,
      phone: row['phone'] as String?,
      companyName: row['company_name'] as String?,
      machineModel: row['machine_model'] as String?,
      machineSerial: row['machine_serial'] as String?,
      onboardingCompletedAt: row['onboarding_completed_at'] != null
          ? DateTime.tryParse(row['onboarding_completed_at'].toString())
          : null,
      appRole: row['app_role'] as String?,
      employeeId: row['employee_id'] as String?,
    );
  }

  /// Row from `public.chat_contacts` (no Supabase Auth — storage only).
  factory CustomerProfile.fromChatContact(Map<String, dynamic> row) {
    return CustomerProfile(
      id: row['id'] as String,
      fullName: row['full_name'] as String?,
      contactEmail: row['email'] as String?,
      phone: row['phone'] as String?,
      companyName: null,
      machineModel: row['machine_model'] as String?,
      machineSerial: row['machine_serial'] as String?,
      onboardingCompletedAt: DateTime.now(),
      appRole: null,
      employeeId: null,
    );
  }

  /// Appended to Claude system prompt so answers use saved machine + contact context.
  String get anthropicContextBlock {
    final b = StringBuffer(
      'This is who you are talking to (saved app profile — use it so you know it is the same user):',
    );
    b.writeln(' Name: ${fullName ?? '—'}');
    b.writeln(' Email (contact): ${contactEmail ?? '—'}');
    if (companyName != null && companyName!.trim().isNotEmpty) {
      b.writeln(' Company: $companyName');
    }
    b.writeln(' Phone: ${phone ?? '—'}');
    b.writeln(' Machine model: ${machineModel ?? '—'}');
    b.writeln(' Serial: ${machineSerial ?? '—'}');
    b.write(
      'Resume the conversation naturally; reference prior messages in this thread when relevant.',
    );
    return b.toString();
  }
}
