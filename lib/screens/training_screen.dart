import 'package:flutter/material.dart';

import '../config/bulletin_spec.dart';
import '../models/customer_profile.dart';
import '../theme/stealth_theme.dart';

/// Bulletin §5: machine-specific training, safety (ANSI/OSHA awareness).
class TrainingScreen extends StatelessWidget {
  const TrainingScreen({super.key, required this.profile});

  final CustomerProfile profile;

  @override
  Widget build(BuildContext context) {
    final model = (profile.machineModel ?? '').toUpperCase();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Training & safety'),
        backgroundColor: StealthColors.panelBlack,
        foregroundColor: StealthColors.mist,
      ),
      body: Container(
        decoration: const BoxDecoration(gradient: StealthGradients.chatBackdrop),
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              'Filtered for your machine: ${profile.machineModel ?? '—'}',
              style: TextStyle(
                color: StealthColors.mist.withValues(alpha: 0.9),
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              'Modules (bulletin): setup, calibration, troubleshooting, maintenance — only '
              'content relevant to your model appears here once your RAG/admin content is linked.',
              style: TextStyle(
                color: StealthColors.mist.withValues(alpha: 0.75),
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 16),
            _moduleTile('Setup & commissioning', model.contains('SS') || model.isEmpty),
            _moduleTile('Cut quality & consumables', true),
            _moduleTile('Chiller & electrical checks', model.contains('X3') || model.contains('SS')),
            _moduleTile('Tube / rotary (if applicable)', model.contains('CPR') || model.contains('2060')),
            const SizedBox(height: 16),
            _safetyCard(),
            const SizedBox(height: 16),
            Text(
              'Roadmap',
              style: TextStyle(
                color: StealthColors.mist.withValues(alpha: 0.85),
                fontWeight: FontWeight.w600,
              ),
            ),
            ...kBulletinRoadmapBullets.map(
              (b) => Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('• ', style: TextStyle(color: StealthColors.mist)),
                    Expanded(
                      child: Text(
                        b,
                        style: TextStyle(
                          color: StealthColors.mist.withValues(alpha: 0.7),
                          fontSize: 13,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _moduleTile(String title, bool enabled) {
    return Opacity(
      opacity: enabled ? 1 : 0.45,
      child: Card(
        color: StealthColors.panelBlack.withValues(alpha: 0.92),
        margin: const EdgeInsets.only(bottom: 10),
        child: ListTile(
          leading: const Icon(Icons.play_circle_outline, color: StealthColors.crimson),
          title: Text(title, style: const TextStyle(color: StealthColors.mist)),
          subtitle: Text(
            enabled
                ? 'Open from Support chat for interactive help, or attach PDFs in admin.'
                : 'Not applicable to your model.',
            style: TextStyle(color: StealthColors.mist.withValues(alpha: 0.65)),
          ),
        ),
      ),
    );
  }

  Widget _safetyCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: StealthGradients.assistantBubble,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: StealthColors.crimson.withValues(alpha: 0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.health_and_safety, color: StealthColors.crimson),
              SizedBox(width: 8),
              Text(
                'Safety (ANSI / OSHA awareness)',
                style: TextStyle(
                  color: StealthColors.mist,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'Always follow local codes, machine manuals, and lockout/tagout. This app gives general '
            'awareness only — not legal or compliance advice.',
            style: TextStyle(
              color: StealthColors.mist.withValues(alpha: 0.85),
              height: 1.35,
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }
}
