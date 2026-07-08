import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:dayzo_app/core/network/connectivity_service.dart';
import 'package:dayzo_app/shared/theme/dayzo_theme.dart';

class OfflineBanner extends StatelessWidget {
  const OfflineBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return Consumer<ConnectivityService>(
      builder: (context, service, _) {
        if (service.online) return const SizedBox.shrink();
        return Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          color: DayzoColors.red.withValues(alpha: 0.2),
          child: const Row(
            children: [
              Icon(Icons.cloud_off, size: 14, color: DayzoColors.red),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Sin conexión — mostrando últimos datos',
                  style: TextStyle(
                    color: DayzoColors.red,
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
