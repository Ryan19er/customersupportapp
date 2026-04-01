import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'app/stealth_shell.dart';
import 'config/env_config.dart';
import 'theme/stealth_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    await dotenv.load(fileName: 'assets/.env');
  } catch (_) {
    runApp(const _ConfigErrorApp());
    return;
  }

  if (EnvConfig.supabaseUrl.isEmpty || EnvConfig.supabaseAnonKey.isEmpty) {
    runApp(const _ConfigErrorApp());
    return;
  }

  await Supabase.initialize(
    url: EnvConfig.supabaseUrl,
    anonKey: EnvConfig.supabaseAnonKey,
  );

  runApp(const StealthApp());
}

class StealthApp extends StatelessWidget {
  const StealthApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Stealth Support',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        scaffoldBackgroundColor: StealthColors.deepBlack,
        colorScheme: ColorScheme.dark(
          primary: StealthColors.crimson,
          surface: StealthColors.panelBlack,
          onSurface: StealthColors.mist,
        ),
      ),
      home: const StealthShell(),
    );
  }
}

class _ConfigErrorApp extends StatelessWidget {
  const _ConfigErrorApp();

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Scaffold(
        body: Container(
          decoration: const BoxDecoration(gradient: StealthGradients.chatBackdrop),
          child: const Center(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Text(
                'Copy assets/.env.example to assets/.env and set '
                'SUPABASE_URL and SUPABASE_ANON_KEY.',
                style: TextStyle(color: StealthColors.mist),
                textAlign: TextAlign.center,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
