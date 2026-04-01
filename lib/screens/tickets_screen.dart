import 'package:flutter/material.dart';

import '../services/chat_repository.dart';
import '../theme/stealth_theme.dart';

/// Bulletin: ticketing with tracking numbers — backed by `support_tickets` (migration 002).
class TicketsScreen extends StatefulWidget {
  const TicketsScreen({super.key, required this.repository});

  final ChatRepository repository;

  @override
  State<TicketsScreen> createState() => _TicketsScreenState();
}

class _TicketsScreenState extends State<TicketsScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _hint;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final list = await widget.repository.listTickets();
    if (!mounted) return;
    setState(() {
      _rows = list;
      _loading = false;
      _hint = list.isEmpty
          ? 'No tickets yet — or run SQL migration 002 in Supabase if tickets never save.'
          : null;
    });
  }

  Future<void> _create() async {
    final subject = await showDialog<String>(
      context: context,
      builder: (context) {
        final c = TextEditingController();
        return AlertDialog(
          backgroundColor: StealthColors.panelBlack,
          title: const Text('New ticket', style: TextStyle(color: StealthColors.mist)),
          content: TextField(
            controller: c,
            style: const TextStyle(color: StealthColors.mist),
            decoration: const InputDecoration(
              hintText: 'Brief subject',
              hintStyle: TextStyle(color: Colors.grey),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, c.text.trim()),
              child: const Text('Create'),
            ),
          ],
        );
      },
    );
    if (subject == null || subject.isEmpty) return;
    final num = await widget.repository.createTicket(subject: subject);
    if (!mounted) return;
    if (num == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Could not create ticket. Run supabase/migrations/002_bulletin_tickets_roles.sql',
          ),
        ),
      );
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Ticket created: $num')),
    );
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Support tickets'),
        backgroundColor: StealthColors.panelBlack,
        foregroundColor: StealthColors.mist,
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _create,
        backgroundColor: StealthColors.crimson,
        child: const Icon(Icons.add),
      ),
      body: Container(
        decoration: const BoxDecoration(gradient: StealthGradients.chatBackdrop),
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    if (_hint != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: Text(
                          _hint!,
                          style: TextStyle(
                            color: StealthColors.mist.withValues(alpha: 0.65),
                            fontSize: 13,
                          ),
                        ),
                      ),
                    ..._rows.map((r) {
                      return Card(
                        color: StealthColors.panelBlack.withValues(alpha: 0.92),
                        child: ListTile(
                          title: Text(
                            r['ticket_number']?.toString() ?? '—',
                            style: const TextStyle(
                              color: StealthColors.mist,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          subtitle: Text(
                            '${r['status'] ?? ''} · ${r['subject'] ?? ''}\n${r['created_at'] ?? ''}',
                            style: TextStyle(
                              color: StealthColors.mist.withValues(alpha: 0.75),
                            ),
                          ),
                        ),
                      );
                    }),
                  ],
                ),
              ),
      ),
    );
  }
}
