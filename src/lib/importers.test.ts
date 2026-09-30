// @vitest-environment happy-dom
import { Encoder, Profile } from '@garmin/fitsdk';
import { describe, expect, it } from 'vitest';
import { guessSport, mapSport, parseFit, parseGpx, parseTcx } from './importers';

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="Garmin Connect" version="1.1" xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:ns3="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <metadata><time>2026-09-28T06:30:00.000Z</time></metadata>
  <trk>
    <name>Morgenrunde Tiergarten</name>
    <type>running</type>
    <trkseg>
      <trkpt lat="52.5000000" lon="13.4000000"><ele>35.0</ele><time>2026-09-28T06:30:00.000Z</time>
        <extensions><ns3:TrackPointExtension><ns3:hr>120</ns3:hr></ns3:TrackPointExtension></extensions></trkpt>
      <trkpt lat="52.5045000" lon="13.4000000"><ele>40.0</ele><time>2026-09-28T06:32:30.000Z</time>
        <extensions><ns3:TrackPointExtension><ns3:hr>150</ns3:hr></ns3:TrackPointExtension></extensions></trkpt>
      <trkpt lat="52.5090000" lon="13.4000000"><ele>45.0</ele><time>2026-09-28T06:35:00.000Z</time>
        <extensions><ns3:TrackPointExtension><ns3:hr>160</ns3:hr></ns3:TrackPointExtension></extensions></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const TCX = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Biking">
      <Id>2026-09-27T15:00:00.000Z</Id>
      <Lap StartTime="2026-09-27T15:00:00.000Z">
        <TotalTimeSeconds>3600</TotalTimeSeconds>
        <DistanceMeters>30000</DistanceMeters>
        <Calories>800</Calories>
        <AverageHeartRateBpm><Value>140</Value></AverageHeartRateBpm>
        <MaximumHeartRateBpm><Value>171</Value></MaximumHeartRateBpm>
        <Track>
          <Trackpoint><Time>2026-09-27T15:00:00.000Z</Time><Position><LatitudeDegrees>48.1</LatitudeDegrees><LongitudeDegrees>11.5</LongitudeDegrees></Position><AltitudeMeters>520</AltitudeMeters><HeartRateBpm><Value>120</Value></HeartRateBpm></Trackpoint>
          <Trackpoint><Time>2026-09-27T15:30:00.000Z</Time><Position><LatitudeDegrees>48.2</LatitudeDegrees><LongitudeDegrees>11.5</LongitudeDegrees></Position><AltitudeMeters>560</AltitudeMeters><HeartRateBpm><Value>150</Value></HeartRateBpm></Trackpoint>
          <Trackpoint><Time>2026-09-27T16:00:00.000Z</Time><Position><LatitudeDegrees>48.25</LatitudeDegrees><LongitudeDegrees>11.6</LongitudeDegrees></Position><AltitudeMeters>530</AltitudeMeters><HeartRateBpm><Value>160</Value></HeartRateBpm></Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

describe('Import', () => {
  it('liest GPX von Garmin inklusive Herzfrequenz und Höhe', () => {
    const [a] = parseGpx(GPX);
    expect(a.sport).toBe('laufen');
    expect(a.name).toBe('Morgenrunde Tiergarten');
    expect(a.startTime).toBe(Date.parse('2026-09-28T06:30:00Z'));
    expect(a.distanceM).toBeGreaterThan(995);
    expect(a.distanceM).toBeLessThan(1005);
    expect(a.durationSec).toBe(300);
    expect(a.elevationGainM).toBe(10);
    expect(a.avgHr).toBe(143);
    expect(a.maxHr).toBe(160);
    expect(a.track).toHaveLength(3);
  });

  it('liest TCX und übernimmt die Werte der Uhr', () => {
    const [a] = parseTcx(TCX);
    expect(a.sport).toBe('radfahren');
    expect(a.distanceM).toBe(30000);
    expect(a.durationSec).toBe(3600);
    expect(a.kcal).toBe(800);
    expect(a.avgHr).toBe(140);
    expect(a.maxHr).toBe(171);
    expect(a.track).toHaveLength(3);
  });

  it('meldet kaputte Dateien verständlich', () => {
    expect(() => parseGpx('<gpx><trk></trk></gpx>')).toThrow(/Keine Strecke/);
    expect(() => parseGpx('kein xml <<<')).toThrow();
  });

  it('liest FIT-Dateien einer Garmin-Uhr', async () => {
    const start = new Date('2026-09-26T07:00:00Z');
    const encoder = new Encoder();
    // Nachrichten wie vom Decoder geliefert (Feldnamen in camelCase)
    const enc = { onMesg: (num: number, mesg: Record<string, unknown>) => encoder.onMesg(num, mesg as never), close: () => encoder.close() };
    enc.onMesg(Profile.MesgNum.FILE_ID, { manufacturer: 'garmin', product: 1, timeCreated: start, type: 'activity' });
    const semi = (deg: number) => Math.round(deg * (2 ** 31 / 180));
    for (let i = 0; i <= 10; i++) {
      enc.onMesg(Profile.MesgNum.RECORD, {
        timestamp: new Date(start.getTime() + i * 30_000),
        positionLat: semi(47.0 + i * 0.0009),
        positionLong: semi(8.0),
        enhancedAltitude: 400 + i,
        heartRate: 140 + i,
      });
    }
    enc.onMesg(Profile.MesgNum.SESSION, {
      timestamp: new Date(start.getTime() + 300_000),
      startTime: start,
      sport: 'running',
      subSport: 'trail',
      totalElapsedTime: 310,
      totalTimerTime: 300,
      totalDistance: 1001,
      totalAscent: 12,
      totalCalories: 85,
      avgHeartRate: 145,
      maxHeartRate: 150,
    });
    const [a] = await parseFit(enc.close());
    expect(a.source).toBe('fit');
    expect(a.sport).toBe('laufen');
    expect(a.startTime).toBe(start.getTime());
    expect(a.durationSec).toBe(300);
    expect(a.elapsedSec).toBe(310);
    expect(a.distanceM).toBe(1001);
    expect(a.elevationGainM).toBe(12);
    expect(a.kcal).toBe(85);
    expect(a.avgHr).toBe(145);
    expect(a.track).toHaveLength(11);
    expect(a.track[10].lat).toBeCloseTo(47.009, 4);
  });

  it('ordnet Sportarten zu', () => {
    expect(mapSport('cycling', 'road')).toBe('radfahren');
    expect(mapSport('training', 'strengthTraining')).toBe('gym');
    expect(mapSport('fitnessEquipment', 'indoorRowing')).toBe('rudern');
    expect(mapSport('lap_swimming')).toBe('schwimmen');
    expect(mapSport('9')).toBeUndefined();
    expect(guessSport(30_000, 3600)).toBe('radfahren');
    expect(guessSport(10_000, 3000)).toBe('laufen');
    expect(guessSport(0, 3000)).toBe('gym');
  });
});
