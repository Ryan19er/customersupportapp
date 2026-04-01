import 'package:flutter/material.dart';

class StealthColors {
  static const blood = Color(0xFFB71C1C);
  static const crimson = Color(0xFFE53935);
  static const deepBlack = Color(0xFF0D0D0D);
  static const panelBlack = Color(0xFF1A1A1A);
  static const mist = Color(0xFFECEFF1);
}

class StealthGradients {
  static const chatBackdrop = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      Color(0xFF2B0000),
      StealthColors.deepBlack,
      Color(0xFF120000),
      Color(0xFF0A0A0A),
    ],
    stops: [0.0, 0.35, 0.7, 1.0],
  );

  static const appBar = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [
      Color(0xFF3D0A0A),
      Color(0xFF1F0505),
    ],
  );

  static const userBubble = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      Color(0xFF8B0000),
      StealthColors.crimson,
    ],
  );

  static const assistantBubble = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      Color(0xFF252525),
      Color(0xFF121212),
    ],
  );
}
