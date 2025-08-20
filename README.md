# GRB Intake Prototype

Dieses Projekt stellt einen minimalen Intake-Mechanismus bereit. Bilder können über ein Webformular hochgeladen werden, eine Testanfrage an eine Nextcloud-Instanz wird unterstützt und aus beliebigem Text lässt sich ein QR-Code generieren.

## Setup

1. Installiere die benötigten Abhängigkeiten (Podman, podman-compose, Python‑Pakete):

   ```bash
   ./install.sh
   ```

2. Kopiere `.env.example` nach `.env` und trage `NC_BASE_URL`, `NC_USER` und `NC_APP_PASSWORD` deiner Nextcloud ein.
3. Starte die Anwendung mit Podman:

   ```bash
   podman-compose -f podman-compose.yml up
   ```

4. Rufe im Browser `http://localhost:8000` auf.

## Funktionsweise

- **Upload**: Mehrere Bilder werden lokal im Verzeichnis `uploads/` gespeichert.
- **Nextcloud-Test**: Der Button „Test Nextcloud“ sendet einen Ping an `/nc/ping` und zeigt die Antwort der OCS-API.
- **QR-Code**: Der Button „QR generieren“ ruft `/qr?text=...` auf und zeigt den generierten Code.

## Tests

- Die Anwendung lässt sich mit `python -m py_compile app/main.py` auf Syntax prüfen.
- Manuelle Tests erfolgen über die Weboberfläche.
