import 'package:flutter/material.dart';

import '../models/customer_profile.dart';
import '../services/chat_repository.dart';
import '../screens/chat_screen.dart';

/// Single-screen shell: Stealth Support chat is the entire customer surface.
/// Guides/Training tabs were removed — when the bot cites a manual or guide,
/// it now delivers a tap-to-open link inline in the chat so customers can
/// download the file directly on their phone.
class StealthMainShell extends StatelessWidget {
  const StealthMainShell({
    super.key,
    required this.repository,
    required this.profile,
    this.onSessionCleared,
  });

  final ChatRepository repository;
  final CustomerProfile profile;

  /// Clears saved contact and returns to pre-auth (e.g. after "Sign out").
  final VoidCallback? onSessionCleared;

  @override
  Widget build(BuildContext context) {
    return ChatScreen(
      repository: repository,
      profile: profile,
      embedded: false,
      onSignedOut: onSessionCleared,
    );
  }
}
