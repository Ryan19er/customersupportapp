import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/customer_profile.dart';
import '../theme/stealth_theme.dart';

/// DIY installation, consumables, external resources — bulletin §1 & §5.
class GuidesScreen extends StatelessWidget {
  const GuidesScreen({super.key, required this.profile});

  final CustomerProfile profile;

  Future<void> _open(String url) async {
    final u = Uri.parse(url);
    if (await canLaunchUrl(u)) {
      await launchUrl(u, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Guides & resources'),
        backgroundColor: StealthColors.panelBlack,
        foregroundColor: StealthColors.mist,
      ),
      body: Container(
        decoration: const BoxDecoration(gradient: StealthGradients.chatBackdrop),
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              'Machine context: ${profile.machineModel ?? '—'} · S/N ${profile.machineSerial ?? '—'}',
              style: TextStyle(
                color: StealthColors.mist.withValues(alpha: 0.85),
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 16),
            _card(
              context,
              title: 'DIY fiber laser installation',
              subtitle:
                  'Step-by-step setup: delivery, power, chiller, gas, workstation. Full PDFs live in your company knowledge base — add links here when hosted.',
              icon: Icons.build_circle_outlined,
            ),
            _card(
              context,
              title: 'Consumables & assist gas',
              subtitle: 'Nozzles, lenses, assist gas — align with your machine manual.',
              icon: Icons.air_outlined,
              onTap: () => _open('https://laserconsumables.com'),
            ),
            _card(
              context,
              title: 'Stealth Laser — products',
              subtitle: 'Official machine lineup and specs.',
              icon: Icons.language,
              onTap: () => _open('https://stealthlaser.com/products/'),
            ),
            _card(
              context,
              title: 'Video placeholders',
              subtitle:
                  'Embed training videos per model (host on Supabase Storage or Vimeo).',
              icon: Icons.video_library_outlined,
            ),
            const SizedBox(height: 12),
            Text(
              'Bulletin: machine-specific guides only for the customer’s model — content is filtered by your profile.',
              style: TextStyle(
                color: StealthColors.mist.withValues(alpha: 0.55),
                fontSize: 12,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _card(
    BuildContext context, {
    required String title,
    required String subtitle,
    required IconData icon,
    VoidCallback? onTap,
  }) {
    return Card(
      color: StealthColors.panelBlack.withValues(alpha: 0.92),
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        leading: Icon(icon, color: StealthColors.crimson),
        title: Text(title, style: const TextStyle(color: StealthColors.mist)),
        subtitle: Text(
          subtitle,
          style: TextStyle(color: StealthColors.mist.withValues(alpha: 0.75)),
        ),
        onTap: onTap,
      ),
    );
  }
}
