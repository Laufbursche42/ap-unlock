# Anleitung

Diese Anleitung führt Schritt für Schritt durch das Apollo Tool. Sie setzt nichts voraus und sagt
offen, was bereits zerlegt ist und was noch nicht.

> **Wichtig für Fehler-Reports:** Schalte unten auf der Seite den **Diagnose-Log** ein, *bevor* du dich mit dem Scooter verbindest. Nur dann wird der komplette Verbindungsaufbau mitgeschnitten - und genau diese Zeilen brauchen wir in einem [Ticket](https://github.com/Laufbursche42/Laufbursche42/issues), um ein Problem nachzuvollziehen.

## Was du brauchst

- Einen Apollo-Scooters-E-Scooter (Hersteller-App "Apollo Scooters", Paketname `com.apolloscooters`).
- Einen Browser mit Web Bluetooth: **Chrome** auf Android oder Desktop, **Bluefy** auf dem iPhone.
  Safari hat kein Web Bluetooth.
- Den Scooter an und in Reichweite.

## Welche Scooter unterstützt werden

Es gibt keine protokollrelevante Modellliste: jedes hier verwendete Register, jeder Rahmen und jede
UUID wurde einmal bestätigt, direkt aus der Hersteller-App und ihrer nativen Bibliothek, und nichts
davon unterscheidet sich je nach Modell. Das Auswahlfeld **Modell** ist unverändert aus der eigenen
`ScooterType`-Aufzählung der Hersteller-App übernommen (28 Einträge, zum Beispiel "Apollo City 2023",
"Apollo Phantom 2025") und dient nur als Beschriftung zu deiner eigenen Orientierung - es ändert nichts
daran, wie die Seite mit dem Scooter spricht.

Die Hersteller-App selbst erkennt einen Scooter an seinem Bluetooth-Namen: ein Name, der mit `hw`,
`apollo` oder `phantom` beginnt (Groß-/Kleinschreibung egal) - wortgleich aus der eigenen
`isHwBleName`-Prüfung der App übernommen. Passt der Name deines Scooters nicht, muss das nichts
bedeuten: Der nach dem Verbinden gefundene GATT-Dienst ist die eigentliche Prüfung, auf die sich die
Seite verlässt.

## 1. Seite öffnen

Öffne die Seite im passenden Browser. Der Kopf zeigt den Verbindungsstatus, den Hell/Dunkel-Schalter und
die Sprachumschaltung DE/EN.

## 2. Verbinden

In der Karte **Verbindung** kannst du optional ein Modell-Etikett wählen und die Modul-PIN eintragen -
der Werksstandard `888888` ist bereits eingetragen (belegt: `defaultPin`/`emulatorPassword` der App).
Tippe auf **Verbinden** und wähle deinen Scooter aus der Geräteliste des Browsers. Die Seite sucht nach
Apollos DATA-Dienst (`F1F0`), um zu bestätigen, dass es wirklich ein Apollo-Scooter ist, und löst dann
den AT/CMD-Dienst (`F2F0`) auf, um die PIN zu senden.

## 3. Live-Werte

Die Karte **Live-Werte** entschlüsselt den 24-Byte-Telemetrie-Rahmen des Scooters (Kopfbyte `0xAB`).
Bei jeder Kachel sind **Byte-Offset, Breite, Vorzeichen, Skalierung und Feldname bewiesen**: die Offsets
durch eigene Zerlegung der nativen Bibliothek von Apollo, die Namen durch die eigene Kotlin-Klasse
`MonitorSnapshot` der Hersteller-App (gefunden durch eine erneute Zerlegung der App mit mehr
Arbeitsspeicher). Offen bleibt nur, welches Bit im Fehler-Feld welchem Fehlercode (`E1`..`F2`)
entspricht - diese Kachel zeigt bis dahin das rohe Bit-Feld als Hex.

## 4. Geschwindigkeit entsperren

Die Karte **Geschwindigkeit** schreibt Register `32` (`0x20`, `limitedSpeedValue`) - dasselbe Register,
das der eigene Code der Hersteller-App zum selben Zweck schreibt, mit derselben Werte-Kodierung (km/h
mal 10). Zwei Werte merkt sich dein Browser:

- **Offen (km/h):** wird von **Entsperren** geschrieben.
- **eKFV (km/h):** wird von **Sperren** geschrieben.

Die vorgegebenen Werte (45 / 20 km/h) sind neutrale Platzhalter, keine für dein Modell oder deinen
Markt bestätigten Werte - die eigene Modellliste von Apollo nennt Höchstgeschwindigkeiten von 35 bis
100 km/h je nach Modell. Passe die Werte deiner Situation an.

Ein Echo im Log heißt nur, dass der Controller die Schreibanfrage erhalten hat. Ob sich die tatsächlich
fahrbare Geschwindigkeit ändert, zeigt nur die Live-Telemetrie - und auch die trägt nur Offset-Namen
(siehe oben). Beobachte den Scooter selbst beim Testen.

## 5. Weitere Einstellungen

Die Karte **Weitere Einstellungen** listet nur Register, deren Adresse *und* Werte-Kodierung direkt aus
dem Kotlin-Code der Hersteller-App (`ApolloBleScootersSdk.java`) belegt sind:

- Gasannahme (Beschleunigung/Bremse), Register 9 / 10.
- Tempomat-Aktivierungszeit, Register 51.
- Auto-Abschaltzeit, Register 52.
- Service-Intervall-Kilometerstand, Register 73.
- Gesamt-Kilometerstand zurücksetzen, Register 0, ein fester Wert (`8192`) - der eigene Code der App
  sendet genau diesen Wert zu genau diesem Zweck. Das ist eine heikle Einmal-Aktion und fragt vorher
  nach.

## Was absichtlich NICHT in diesem Werkzeug steckt

- **Wegfahrsperre (Ludo), Gangwahl und Beleuchtung.** Die Hersteller-App schreibt diese über einen
  anderen Rahmen (`buildSetBaseParamsFrame`); dessen 10-Byte-Kopf ist belegt, aber die Bit-Position
  jedes einzelnen Flags im Statusbyte ließ sich aus der zerlegten Bibliothek allein nicht klären - dazu
  bräuchte es die eigene Aufrufstelle des Herstellers, die nicht vorlag. Statt eine Bit-Position zu
  raten, lässt dieses Werkzeug die Funktion ganz weg.
- **Modulationsgrad, Motor-Polpaare, max. Entladestrom, max. Bremsstrom, Unterspannungsschutz,
  Raddurchmesser, Trägerfrequenz.** Die Hersteller-App liest und zeigt diese Namen, aber keine
  Schreib-Registeradresse dafür fand sich in den vorliegenden Quellen. Eine Adresse von einem anderen
  Hersteller-Produkt zu raten wäre nicht redlich, deshalb fehlen sie hier statt erfunden zu werden.

## Wenn etwas nicht klappt

- **Der Scooter taucht nicht in der Liste auf.** Ist er an und in Reichweite? Nutze den Knopf
  **Diagnose: alle Geräte** in der Log-Karte. Er zeigt jedes Bluetooth-Gerät, ordnet den Namen genauso
  ein wie die Hersteller-App und listet nach dem Verbinden die GATT-Dienste. Danach den Log kopieren
  und schicken.
- **PIN wird abgelehnt / Schreibvorgänge bleiben wirkungslos.** Möglicherweise wurde der AT/CMD-Dienst
  nicht gefunden - prüfe im Log auf "AT/CMD service (F2F0) not found".
- **Keine Live-Wert-Kachel füllt sich.** Prüfe im Log auf eingehende RX-Zeilen mit Kopfbyte `0xAB`;
  Rahmen unter 24 Byte werden geloggt, aber nicht entschlüsselt.

## Recht

Das Anheben der Höchstgeschwindigkeit hebt die Drossel auf. Die Betriebserlaubnis erlischt und der
Betrieb auf öffentlichen Wegen ist dann nicht erlaubt. Nutze das Werkzeug nur am eigenen Fahrzeug auf
privatem Gelände und auf eigenes Risiko.

## Mithelfen
Willst du herausfinden, ob und wie Tuning bei deinem Scooter geht? Teste dieses Tool an deinem eigenen Fahrzeug und öffne ein Ticket auf [GitHub](https://github.com/Laufbursche42/Laufbursche42/issues) - mit deinem Modell und was funktioniert hat (oder nicht). So finden wir gemeinsam heraus, was bei welchem Modell möglich ist.
