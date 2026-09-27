# Laufbursche Apollo Tool

A static web page that talks to an Apollo Scooters e-scooter over Web Bluetooth, using Apollo's own
proprietary "Mach" BLE protocol. Nothing to install: no app store, no signing, no developer account.
It runs in **Bluefy** on iOS and in **Chrome** on Android or desktop.

> **This is a feasibility study.** Every protocol value used here (GATT UUIDs, frame byte layout, CRC
> parameters, register indices, the BLE-name check and the model list) was read directly out of
> Apollo's own app: its decompiled JS bundle, its Kotlin bridge, and a full disassembly of its native
> library `libapollo-ble.so`. Nothing is borrowed from any other manufacturer's app. None of it is
> verified on a real Apollo scooter. Read the [Disclaimer](#disclaimer) before you connect a scooter.

Run it yourself, no build step, no dependencies: clone the repo and serve the folder over a local
HTTP server. Opening `index.html` directly as a `file://` URL will not work, the page fetches its own
documents and browsers block that over `file://`.

```
git clone https://github.com/Laufbursche42/ap-unlock.git
cd ap-unlock
python -m http.server 8000
```

Then open the printed address in a browser that supports Web Bluetooth.

**Guide: [Deutsch](GUIDE.de.md) | [English](GUIDE.en.md)** covers every step, from the first connect to
what is and is not decoded yet.

## What it does

- **Speed limit unlock** over BLE: the Unlock/Lock button writes register `32` (`0x20`,
  `limitedSpeedValue`, value km/h times 10) - the same register and encoding the manufacturer app's own
  Kotlin bridge uses (`ApolloBleScootersSdk.java`, `setAdvParams`). The write's frame format is confirmed
  by disassembly of `libapollo-ble.so`, not guessed.
- **A handful of other registers** the manufacturer app itself documents and can write: throttle and
  brake response, cruise-activation time, auto-shutdown time, service-interval mileage, and a total-
  mileage reset (register `0`, fixed value `8192`).
- **Live telemetry, named and cited.** The 24-byte monitor frame's byte offsets, widths, signs and
  scaling are confirmed by disassembly, and the field names (speed, voltage, current, power,
  temperatures, mileage, ...) are confirmed from the manufacturer app's own Kotlin class
  `MonitorSnapshot`. Only the individual fault-code bit assignment is still open.
- **A full protocol log** you can copy and share, plus a diagnostics scan that lists every device and
  its GATT services.
- **The model list is Apollo's own**, copied unchanged from the app's `ScooterType` catalogue. It is a
  label only; no BLE behaviour differs by model in what has been reverse engineered so far.

**What this tool deliberately does not offer**, because the byte-level detail is not yet reverse
engineered: the immobilizer (Ludo) lock/unlock, gear selection, lights, and several advanced-parameter
registers the app reads but whose write address was not recovered (modulation depth, motor pole pairs,
max discharge/braking current, undervoltage protection, wheel diameter, carrier frequency). See the
guide's "not yet reverse-engineered" list - nothing here is a guess dressed up as a fact.

> **Unlocking the app is not the same as unlocking the scooter.** Writing a higher value into register
> `32` only means the app sends it. Whether the setting takes effect is decided by the firmware on the
> controller, which validates every value and can silently cap or reject it. The real top-speed cap sits
> in the controller firmware and is not observable from here.

## Disclaimer

**Please read this in full before you unlock a scooter.**

- **This is a feasibility study**, not a finished product. It shows what the scooter's Bluetooth
  protocol makes possible. Nothing here promises that it works with your scooter, your phone or your
  browser, or that it still works after the next controller firmware or browser release.
- **Unlocking ends the road approval.** A scooter that no longer holds its speed limit is not road-legal
  any more. The operating permit is void, and the insurance cover goes with it.
- **Ride it on private property only.** Riding a derestricted scooter in public traffic is an offence in
  Germany: no operating permit, no insurance. The liability is entirely yours.
- **No liability** and **no warranty** of function, correctness or fitness for a particular purpose.
- Everything you do with this page is **at your own risk**.

By using this page you accept these terms.

## License

PolyForm Noncommercial 1.0.0 with two additional terms, in full in [LICENSE.md](LICENSE.md).

## Privacy

Nothing leaves your device but the page load itself. The details are in [PRIVACY.md](PRIVACY.md).

## Trademarks

An independent project, not affiliated with Apollo Scooters. "Apollo" and other product names are
trademarks of their respective owners and are used here only to say which scooters this page works with.
See [TRADEMARKS.md](TRADEMARKS.md).
