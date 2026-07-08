import 'dart:convert';

import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart' as p;

import 'package:dayzo_app/data/models/tasas_data.dart';
import 'package:dayzo_app/data/models/historial_point.dart';

class LocalDb {
  static final LocalDb _instance = LocalDb._();
  factory LocalDb() => _instance;
  LocalDb._();

  Database? _db;

  Future<Database> get db async {
    if (_db != null) return _db!;
    _db = await _open();
    return _db!;
  }

  Future<Database> _open() async {
    final dir = await getDatabasesPath();
    final path = p.join(dir, 'dayzo_cache.db');
    return openDatabase(
      path,
      version: 1,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE snapshot_cache (
            id INTEGER PRIMARY KEY CHECK(id = 1),
            json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          )
        ''');
        await db.execute('''
          CREATE TABLE historial_cache (
            range TEXT PRIMARY KEY,
            json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          )
        ''');
      },
    );
  }

  // ── Snapshot ───────────────────────────────────────────────────────

  Future<void> saveSnapshot(TasasSnapshot snapshot) async {
    final map = {
      'tasas': {
        'binance': snapshot.tasas.binance,
        'binance_compra': snapshot.tasas.binanceCompra,
        'bcv': snapshot.tasas.bcv,
        'bcv_publicada': snapshot.tasas.bcvPublicada,
        'cny': snapshot.tasas.cny,
      },
      'bcv_meta': {
        'vigente_para': snapshot.bcvMeta.vigentePara,
        'publicada_el': snapshot.bcvMeta.publicadaEl,
        'nota': snapshot.bcvMeta.nota,
        'hay_nueva_publicada': snapshot.bcvMeta.hayNuevaPublicada,
      },
      'diff_bs': snapshot.diffBs,
      'diff_pct': snapshot.diffPct,
      'last_update': snapshot.lastUpdate,
      if (snapshot.binanceStats != null)
        'binance_stats': {
          'change24h': snapshot.binanceStats!.change24h,
          'changePct24h': snapshot.binanceStats!.changePct24h,
        },
      if (snapshot.bcvStats != null)
        'bcv_stats': {
          'change24h': snapshot.bcvStats!.change24h,
          'changePct24h': snapshot.bcvStats!.changePct24h,
        },
    };
    final now = DateTime.now().millisecondsSinceEpoch;
    final d = await db;
    await d.insert(
      'snapshot_cache',
      {'id': 1, 'json': jsonEncode(map), 'updated_at': now},
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<TasasSnapshot?> getSnapshot() async {
    final d = await db;
    final rows = await d.query('snapshot_cache', where: 'id = 1');
    if (rows.isEmpty) return null;
    final json = jsonDecode(rows.first['json'] as String) as Map<String, dynamic>;
    return TasasSnapshot.fromApi(json);
  }

  Future<int?> getSnapshotUpdatedAt() async {
    final d = await db;
    final rows = await d.query('snapshot_cache',
        columns: ['updated_at'], where: 'id = 1');
    if (rows.isEmpty) return null;
    return rows.first['updated_at'] as int;
  }

  // ── Historial ──────────────────────────────────────────────────────

  Future<void> saveHistorial(
    String range,
    List<HistorialPoint> points,
    ChartStats? stats,
  ) async {
    final map = {
      'historial': points.map((p) => p.toJson()).toList(),
      if (stats != null) 'chartStats': stats.toJson(),
    };
    final now = DateTime.now().millisecondsSinceEpoch;
    final d = await db;
    await d.insert(
      'historial_cache',
      {'range': range, 'json': jsonEncode(map), 'updated_at': now},
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<({List<HistorialPoint> points, ChartStats? stats})?> getHistorial(
    String range,
  ) async {
    final d = await db;
    final rows =
        await d.query('historial_cache', where: 'range = ?', whereArgs: [range]);
    if (rows.isEmpty) return null;
    final data = jsonDecode(rows.first['json'] as String) as Map<String, dynamic>;
    final rawList = data['historial'] as List<dynamic>? ?? [];
    final points = rawList.cast<Map<String, dynamic>>().map(
      (json) => HistorialPoint.fromJson(json),
    ).toList();
    ChartStats? stats;
    final statsJson = data['chartStats'] as Map<String, dynamic>?;
    if (statsJson != null) {
      stats = ChartStats.fromJson(statsJson);
    }
    return (points: points, stats: stats);
  }

  Future<int?> getHistorialUpdatedAt(String range) async {
    final d = await db;
    final rows = await d.query('historial_cache',
        columns: ['updated_at'], where: 'range = ?', whereArgs: [range]);
    if (rows.isEmpty) return null;
    return rows.first['updated_at'] as int;
  }
}
