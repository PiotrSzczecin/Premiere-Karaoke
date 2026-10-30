# Instalacja na Windows

## Wymagania

- Windows 10/11;
- Adobe Premiere Pro 26.3+;
- UXP Developer Tool 2.2+ z Creative Cloud Desktop;
- Python 3.11 dla WhisperX (launcher może zainstalować go automatycznie);
- FFmpeg w `PATH` dla formatów innych niż WAV i zależności audio WhisperX;
- około 5–15 GB wolnego miejsca na PyTorch i modele alignmentu.

Lokalny audyt środowiska deweloperskiego wykrył Premiere 26.0.1, After Effects 25.6, brak UDT i brak FFmpeg. After Effects nie jest używany. Premiere musi zostać zaktualizowany przed testem panelu w hoście.

## Panel

1. Zainstaluj UXP Developer Tool z Creative Cloud Desktop.
2. W Premiere otwórz `Edit → Preferences → Plugins`, włącz Developer Mode i zrestartuj Premiere.
3. W UDT kliknij `Add Plugin`.
4. Wskaż `packages\panel\manifest.json`.
5. Kliknij `Load` albo `Load & Watch`.
6. Panel znajdziesz w `Window → UXP Plugins → Karaoke Captions PL`.

Gotowy katalog `dist` jest dołączony. `npm install` jest potrzebne tylko do typechecku lub rozwoju.

## Helper — najprościej

Tryb szybki działa bez Pythona i bez helpera. Dla trybu dokładnego kliknij dwukrotnie `URUCHOM_HELPER_DOKLADNY.cmd` w głównym folderze paczki. Przy pierwszym uruchomieniu skrypt automatycznie:

1. odnajdzie lub zainstaluje Python 3.11;
2. odnajdzie lub zainstaluje FFmpeg potrzebny m.in. dla MPG/MPEG-2;
3. utworzy `.venv` i zainstaluje WhisperX;
4. uruchomi helper na `127.0.0.1:8765`.

Zostaw okno helpera otwarte podczas pracy w Premiere. Pierwsza instalacja może trwać kilkanaście minut i zająć kilka GB.

Sprawdzenie helpera:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/v1/health
```

## Helper — instalacja ręczna

Zainstaluj FFmpeg (np. przez `winget install Gyan.FFmpeg`) i ponownie otwórz terminal. Następnie:

```powershell
cd packages\alignment-service
py install 3.11
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -U pip
python -m pip install -e ".[exact]"
python -m karaoke_sync --verbose
```

CPU działa, ale jest wolny. Dla zgodnego GPU NVIDIA zainstaluj wariant PyTorch/CUDA zgodnie z oficjalnym selektorem PyTorch, a następnie uruchom:

```powershell
$env:KARAOKE_DEVICE = "cuda"
python -m karaoke_sync
```

Po jednorazowym pobraniu modeli można zablokować dostęp do repozytoriów modeli:

```powershell
$env:KARAOKE_OFFLINE = "1"
python -m karaoke_sync
```

## Opcjonalny EXE

```powershell
cd packages\alignment-service
python -m pip install -e ".[exact,build]"
pyinstaller karaoke-sync.spec --clean
```

Wynik znajdzie się w `dist\karaoke-sync.exe`. Modele WhisperX nadal powinny być wcześniej pobrane do cache użytkownika albo dołączone zgodnie z ich licencjami.

## Produkcyjny CCX

W UXP Developer Tool użyj `Package`. Paczka deweloperska używa identyfikatora `com.pilne24.premiere-karaoke`; przed dystrybucją nadaj zarejestrowany identyfikator Adobe i podpisz CCX. ZIP z repozytorium służy do testu deweloperskiego.
