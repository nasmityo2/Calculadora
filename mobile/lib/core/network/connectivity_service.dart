import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:connectivity_plus/connectivity_plus.dart';

class ConnectivityService extends ChangeNotifier {
  ConnectivityService() {
    _init();
  }

  bool _online = true;
  bool get online => _online;

  StreamSubscription<List<ConnectivityResult>>? _subscription;

  Future<void> _init() async {
    final result = await Connectivity().checkConnectivity();
    _updateStatus(result);
    _subscription = Connectivity().onConnectivityChanged.listen(_updateStatus);
  }

  void _updateStatus(List<ConnectivityResult> result) {
    final wasOnline = _online;
    _online = !result.contains(ConnectivityResult.none);
    if (wasOnline != _online) {
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }
}
