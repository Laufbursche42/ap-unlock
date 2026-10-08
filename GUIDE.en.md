# Guide

This guide walks through the Apollo tool step by step. It assumes nothing, and it is upfront about
what is and is not reverse engineered yet.

> **Important for error reports:** switch on the **Diagnostic log** at the bottom of the page *before* you connect to the scooter. Only then is the full connection handshake captured - and those are exactly the lines we need in a [ticket](https://github.com/Laufbursche42/Laufbursche42/issues) to reproduce a problem.

## What you need

- An Apollo Scooters e-scooter (manufacturer app "Apollo Scooters", package `com.apolloscooters`).
- A browser with Web Bluetooth: **Chrome** on Android or desktop, **Bluefy** on iPhone. Safari has no
  Web Bluetooth.
- The scooter on and in range.

## Which scooters are supported

The tool has no protocol-relevant model list: every register, frame and UUID used here was confirmed
once, from Apollo's own app and its native library, and nothing in that confirmed material differs by
model. The **Model** dropdown is copied from the manufacturer app's own `ScooterType` catalogue (28
entries, e.g. "Apollo City 2023", "Apollo Phantom 2025") purely as a label for your own reference - it
does not change how the page talks to the scooter.

The manufacturer app itself recognizes a scooter's Bluetooth advertisement by name: a name starting
with `hw`, `apollo` or `phantom` (case-insensitive) - this is copied verbatim from the app's own
`isHwBleName` check. If your scooter's name does not match, it is not necessarily wrong: the GATT
service found after connecting is the real test the page relies on.

## 1. Open the page

Open the page in the right browser. The header shows the connection status, the light/dark toggle and
the DE/EN language switch.

## 2. Connect

The **Connection** card lets you pick a model label (optional) and enter the module PIN - the factory
default `888888` is pre-filled (confirmed: the app's own `defaultPin`/`emulatorPassword`). Tap
**Connect**, pick your scooter from the browser's device list. The page looks for Apollo's DATA service
(`F1F0`) to confirm it is really an Apollo scooter, then resolves the AT/CMD service (`F2F0`) to send
the PIN.

## 3. Live values

The **Live values** card decodes the scooter's 24-byte telemetry frame (header byte `0xAB`). Every
tile's **byte offset, width, sign and scaling, and its field name, are confirmed**: the offsets from
disassembling Apollo's native library, the names from the manufacturer app's own Kotlin class
`MonitorSnapshot` (recovered by re-decompiling the app with a larger heap). The one thing still open is
which bit inside the fault-flags field maps to which fault code (`E1`..`F2`) - that tile shows the raw
flag word in hex until that is resolved.

## 4. Speed unlock

The **Speed** card writes register `32` (`0x20`, `limitedSpeedValue`) - this is the same register the
manufacturer app's own code writes for the same purpose, with the same value encoding (km/h times 10).
Two values are stored in your browser:

- **Open (km/h):** written by **Unlock**.
- **eKFV (km/h):** written by **Lock**.

The defaults shown (45 / 20 km/h) are neutral placeholders, not values confirmed for your specific
model or market - Apollo's own model catalogue lists a top speed anywhere from 35 to 100 km/h depending
on model, so adjust these to your own situation.

An echo in the log only means the controller received the write. Whether it actually changes the speed
you can ride shows only in the live telemetry, and even that is offset-labelled rather than named (see
above) - watch the scooter itself while testing.

## 5. More settings

The **More settings** card only lists registers whose address *and* value encoding are directly
confirmed from the manufacturer app's own Kotlin bridge code (`ApolloBleScootersSdk.java`):

- Throttle response (accel/brake), register 9 / 10.
- Cruise-activation time, register 51.
- Auto-shutdown time, register 52.
- Service-interval mileage, register 73.
- Total-mileage reset, register 0, a fixed value (`8192`) - the app's own code sends this exact value
  for this exact purpose. This is a risky, one-shot write: it asks for confirmation first.

## What is deliberately NOT in this tool

- **The immobilizer (Ludo), gear selection and lights.** The manufacturer app writes these through a
  different frame (`buildSetBaseParamsFrame`); its 10-byte header is confirmed but the bit position of
  each individual flag inside the status byte could not be resolved from the disassembled library
  alone - it would need the manufacturer's own call site, which was not available. Rather than guess a
  bit position, this tool leaves the feature out entirely.
- **Modulation depth, motor pole pairs, max discharge/braking current, undervoltage protection, wheel
  diameter, carrier/PWM frequency.** The manufacturer app reads and displays these names, but no
  write-register address for them was found anywhere in the recovered sources. Guessing one from a
  different manufacturer's product would not be honest, so these are left out rather than faked.

## If something does not work

- **The scooter does not appear in the list.** Is it on and in range? Use the **Diagnostics: all
  devices** button in the log card. It shows every Bluetooth device, classifies the name the same way
  the manufacturer app does, and lists the GATT services after connecting. Then copy the log and send
  it.
- **PIN rejected / writes silently ignored.** The AT/CMD service might not have been found - check the
  log for "AT/CMD service (F2F0) not found".
- **No live-value tile fills in.** Check the log for incoming RX lines starting with a `0xAB` header
  byte; frames shorter than 24 bytes are logged but not decoded.

## Legal

Raising the top speed removes the throttle limit. The road approval lapses and riding on public roads
is then not allowed. Use the tool only on your own vehicle on private ground and at your own risk.

## Contribute
Want to find out if and how tuning works on your scooter? Test this tool on your own vehicle and open a ticket on [GitHub](https://github.com/Laufbursche42/Laufbursche42/issues) - with your model and what worked (or did not). That way we figure out together what is possible on which model.
