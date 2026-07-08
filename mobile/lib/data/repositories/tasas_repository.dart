import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:web_socket_channel/web_socket_channel.dart';

import 'package:dayzo_app/core/config/api_config.dart';
import 'package:dayzo_app/data/models/tasas_data.dart';

class TasasRepository {
  TasasRepository({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;
  WebSocketChannel? _channel;
  StreamSubscription? _wsSub;

  Future<TasasSnapshot> fetchTasas() async {
    final response = await _client.get(ApiConfig.tasasUri());
    if (response.statusCode != 200) {
      throw Exception('Error ${response.statusCode} al cargar tasas');
    }
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    var snapshot = TasasSnapshot.fromApi(json);

    try {
      final statsRes = await _client.get(ApiConfig.statsUri());
      if (statsRes.statusCode == 200) {
        final statsJson = jsonDecode(statsRes.body) as Map<String, dynamic>;
        snapshot = snapshot.copyWithStats(statsJson);
      }
    } catch (_) {
      // Stats opcionales: la app sigue funcionando sin ellas.
    }

    return snapshot;
  }

  void connectWebSocket(void Function(TasasSnapshot) onUpdate) {
    disconnectWebSocket();
    _channel = WebSocketChannel.connect(ApiConfig.wsUri());
    _wsSub = _channel!.stream.listen(
      (event) {
        try {
          final msg = jsonDecode(event as String) as Map<String, dynamic>;
          if (msg['type'] != 'tasas_update') return;
          final data = msg['data'] as Map<String, dynamic>? ?? {};
          onUpdate(TasasSnapshot.fromApi(data));
        } catch (_) {
          // Ignorar mensajes malformados.
        }
      },
      onError: (_) => _scheduleReconnect(onUpdate),
      onDone: () => _scheduleReconnect(onUpdate),
      cancelOnError: true,
    );
  }

  Timer? _reconnectTimer;

  void _scheduleReconnect(void Function(TasasSnapshot) onUpdate) {
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(const Duration(seconds: 5), () {
      connectWebSocket(onUpdate);
    });
  }

  void disconnectWebSocket() {
    _reconnectTimer?.cancel();
    _wsSub?.cancel();
    _channel?.sink.close();
    _channel = null;
    _wsSub = null;
  }

  void dispose() {
    disconnectWebSocket();
    _client.close();
  }
}
