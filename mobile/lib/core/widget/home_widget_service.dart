import 'package:home_widget/home_widget.dart';

import 'package:dayzo_app/core/utils/formatters.dart';
import 'package:dayzo_app/data/models/tasas_data.dart';

class HomeWidgetService {
  static const _widgetName = 'DayzoHomeWidget';

  /// Pushes the latest rates to the home widget and triggers an update.
  static Future<void> updateHomeWidget(TasasSnapshot snapshot) async {
    try {
      await HomeWidget.saveWidgetData<String>(
        'binanceCompra',
        formatMoney(snapshot.tasas.binanceCompra),
      );
      await HomeWidget.saveWidgetData<String>(
        'bcv',
        formatMoney(snapshot.tasas.bcv),
      );
      await HomeWidget.saveWidgetData<String>(
        'timestamp',
        extractTimeFromUpdate(snapshot.lastUpdate),
      );
      await HomeWidget.updateWidget(
        name: _widgetName,
        qualifiedAndroidName:
            'lat.dayzove.dayzo_app.DayzoHomeWidget',
      );
    } catch (e) {
      // Widget update failures are non-critical — the widget will show
      // its default layout until the next successful update.
    }
  }
}
