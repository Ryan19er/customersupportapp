import 'package:flutter/material.dart';

import '../models/customer_profile.dart';
import '../services/chat_repository.dart';
import '../screens/chat_screen.dart';
import '../screens/guides_screen.dart';
import '../screens/tickets_screen.dart';
import '../screens/training_screen.dart';
import '../screens/account_screen.dart';
import '../theme/stealth_theme.dart';

/// Bulletin: single app shell — Chat, Guides, Tickets, Training, Account (tabs).
class StealthMainShell extends StatefulWidget {
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
  State<StealthMainShell> createState() => _StealthMainShellState();
}

class _StealthMainShellState extends State<StealthMainShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final pages = <Widget>[
      ChatScreen(
        repository: widget.repository,
        profile: widget.profile,
        embedded: true,
        onSignedOut: widget.onSessionCleared,
      ),
      GuidesScreen(profile: widget.profile),
      TicketsScreen(repository: widget.repository),
      TrainingScreen(profile: widget.profile),
      AccountScreen(
        repository: widget.repository,
        profile: widget.profile,
        onSignedOut: widget.onSessionCleared,
      ),
    ];

    return Scaffold(
      body: IndexedStack(
        index: _index,
        children: pages,
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        backgroundColor: StealthColors.panelBlack,
        indicatorColor: StealthColors.crimson.withValues(alpha: 0.35),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.support_agent_outlined),
            selectedIcon: Icon(Icons.support_agent),
            label: 'Support',
          ),
          NavigationDestination(
            icon: Icon(Icons.menu_book_outlined),
            selectedIcon: Icon(Icons.menu_book),
            label: 'Guides',
          ),
          NavigationDestination(
            icon: Icon(Icons.confirmation_number_outlined),
            selectedIcon: Icon(Icons.confirmation_number),
            label: 'Tickets',
          ),
          NavigationDestination(
            icon: Icon(Icons.school_outlined),
            selectedIcon: Icon(Icons.school),
            label: 'Training',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: 'Account',
          ),
        ],
      ),
    );
  }
}
