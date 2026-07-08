// Run with: flutter test tool/generate_splash_logo_test.dart
// Generates assets/dayzo_splash_logo.png
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('Generate splash logo', (tester) async {
    final logo = await _renderLogo();
    final dir = Directory('assets');
    if (!dir.existsSync()) dir.createSync(recursive: true);
    final file = File('${dir.path}/dayzo_splash_logo.png');
    await file.writeAsBytes(logo);
    print('Logo generated: ${file.absolute.path}');
  });
}

Future<List<int>> _renderLogo() async {
  const width = 400.0;
  const height = 120.0;
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);

  final paragraphBuilder = ui.ParagraphBuilder(
    ui.ParagraphStyle(
      textAlign: TextAlign.center,
      textDirection: ui.TextDirection.ltr,
      fontWeight: FontWeight.w900,
      fontSize: 64,
    ),
  )
    ..pushStyle(ui.TextStyle(
      color: const Color(0xFFE8541A),
      fontSize: 64,
      fontWeight: FontWeight.w900,
      letterSpacing: 2.0,
    ))
    ..addText('DAYZO');

  final paragraph = paragraphBuilder.build()
    ..layout(const ui.ParagraphConstraints(width: 400));

  canvas.drawParagraph(
    paragraph,
    Offset(0, (height - paragraph.height) / 2),
  );

  final picture = recorder.endRecording();
  final image = await picture.toImage(width.toInt(), height.toInt());
  final byteData = (await image.toByteData(format: ui.ImageByteFormat.png))!;
  return byteData.buffer.asUint8List();
}
