# Premiere Karaoke UXP

Panel UXP dla Adobe Premiere Pro 26.3+ tworzący nieruchome, pełnozdaniowe napisy karaoke. Dla każdego słowa powstaje osobny stan z pełnym tekstem; zmienia się wyłącznie styl aktualnego słowa. Stany stykają się bez luk i po konwersji są niezależnymi, edytowalnymi klipami `Graphic` na zwykłej ścieżce wideo.

Projekt nie używa MOGRT, After Effects, Dynamic Link ani renderowanych overlayów.

## Nowe w 0.4.8

- Drugi wbudowany preset **Music Xmas**: białe napisy, śpiewane słowo czerwone `#E31E24`, zaśpiewane beżowe `#E8D5B0`; font, obrys i położenie jak w Szlagier TV.

## Nowe w 0.4.7

- **Presety kanałów** w sekcji „Wygląd”: wbudowany **Szlagier TV** (biały / żółty `#FFD400` / jasnoniebieski `#8ED8FF`, czarny obrys 5 px, Arial-BoldMT 82) oraz własne presety zapisywane przyciskiem „Zapisz obecny wygląd jako preset”. Panel pamięta ostatnio użyty preset.
- Poprawka TTML: wiersz nie dostaje dodatkowej spacji, gdy aktywne słowo stoi na końcu wiersza, więc wyśrodkowany tekst nie przesuwa się przy zmianie słowa.
- Naprawione polskie znaki w źródle `packages/panel/src/main.ts`.

## Instalacja na stałe (bez UXP Developer Tool)

Panel ładowany przez UXP Developer Tool znika po restarcie Premiere. Do codziennej pracy zainstaluj paczkę `.ccx`:

1. Zamknij Premiere.
2. Kliknij dwukrotnie `release\KaraokeCaptionsPL-0.4.8.ccx` albo uruchom:

   ```powershell
   & "C:\Program Files\Common Files\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe" /install "release\KaraokeCaptionsPL-0.4.8.ccx"
   ```

3. Uruchom Premiere i otwórz **Window → UXP Plugins → Karaoke Captions PL**.

Odinstalowanie: `UnifiedPluginInstallerAgent.exe /remove "Karaoke Captions PL"`. Nowszą wersję instaluje się tą samą komendą — zastępuje poprzednią.

## Co działa automatycznie

- parser SRT: UTF-8, BOM, CRLF/LF, polskie znaki, wielowierszowość i podstawowe znaczniki `<i>`, `<b>`, `<u>`, `<font>`;
- walidacja timecode i nakładających się wpisów;
- szybkie, ważone czasy słów oraz lokalny forced alignment przez opcjonalny WhisperX;
- ręczna korekta słów, przesuwanie wpisu, podgląd i zapis `.karaoke.json`;
- tworzenie osobnego, bezlukowego segmentu TTML dla każdego aktywnego słowa;
- spacja zapisywana bezpośrednio przed każdym `</span>`, zgodnie z zachowaniem importera Premiere;
- dokładne dopasowanie może rozszerzyć granice SRT do rzeczywistego pierwszego/ostatniego słowa, z regulowanym czasem pojawienia i podtrzymania;
- nazwa XML jest automatycznie dziedziczona z nazwy SRT, a wybrane audio/wideo trafia również do projektu Premiere;
- pełny tekst w każdym segmencie, style bazowy/aktywny/przeczytany, pozycja i zachowane ręczne łamanie;
- import wygenerowanego TTML do projektu Premiere;
- dopasowanie gotowych grafik po precyzyjnych granicach czasu i zaznaczanie pierwszych/ostatnich stanów do Text Animatora;
- usuwanie wcześniej dopasowanych klipów po potwierdzeniu;
- komunikacja z helperem wyłącznie przez `127.0.0.1:8765`.

## Ważne ograniczenie API Adobe

Oficjalne API UXP 26.3 nie udostępnia obiektu `Graphic`, tworzenia warstwy tekstowej, formatowania zakresu tekstu, tworzenia Caption Track ani wywołania polecenia **Upgrade Caption to Graphic**. Dlatego jeden etap jest ręczny:

1. W panelu kliknij **Generuj wszystko + sekwencja**. Import TTML wykona się automatycznie, a panel spróbuje utworzyć sekwencję bezpośrednio z Caption. Po utworzeniu sprawdzi rzeczywistą liczbę ścieżek Caption; pustą sekwencję usunie i pokaże instrukcję ręcznego przeciągnięcia TTML.
2. Zaznacz wszystkie segmenty Caption.
3. Wybierz **Graphics and Titles → Upgrade Caption to Graphic**.
4. Usuń tymczasową ścieżkę Caption.

Finalnie na timeline pozostają wyłącznie natywne klipy `Graphic`. Szczegóły i źródła: `docs/API_LIMITATIONS.md`.

## Struktura

```text
packages/panel/                 panel UXP, TypeScript i gotowy dist
packages/shared/                parser, timing, TickTime, stany Graphic i TTML
packages/alignment-service/     lokalny serwer Python + opcjonalny WhisperX
examples/                       SRT i przykładowy projekt JSON
schemas/                        JSON Schema projektu
tests/                          mock oficjalnego API Premiere
docs/                           instalacja, test hosta i ograniczenia
```

## Szybki start

Pełna instrukcja Windows znajduje się w `docs/INSTALL_WINDOWS.md`.

1. Zaktualizuj Premiere do 26.3 lub nowszego i zainstaluj UXP Developer Tool 2.2+.
2. W Premiere włącz **Settings → Plugins → Enable developer mode** i uruchom aplikację ponownie.
3. Dla trybu dokładnego kliknij dwukrotnie `URUCHOM_HELPER_DOKLADNY.cmd`. Skrypt sam instaluje lub odnajduje Python 3.11, FFmpeg i biblioteki, a następnie uruchamia helper. Zostaw jego okno otwarte.

   Ręczne komendy są potrzebne tylko do diagnostyki:

   ```powershell
   cd packages\alignment-service
   py install 3.11
   py -3.11 -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m karaoke_sync
   ```

4. W UXP Developer Tool wybierz **Add Plugin** i wskaż `packages\panel\manifest.json`, potem **Load**.
5. Otwórz **Window → UXP Plugins → Karaoke Captions PL**.

Tryb szybki nie wymaga helpera ani Pythona. Dla trybu dokładnego zalecany jest launcher `URUCHOM_HELPER_DOKLADNY.cmd`. Ręczna instalacja FFmpeg i zależności:

```powershell
cd packages\alignment-service
python -m pip install -U pip
python -m pip install -e ".[exact]"
```

Pierwsze uruchomienie WhisperX może pobrać model. Po zapisaniu modeli w cache można wymusić pracę offline:

```powershell
$env:KARAOKE_OFFLINE = "1"
python -m karaoke_sync
```

Audio nigdy nie jest wysyłane do usługi sieciowej przez ten projekt.

## Typowy przepływ

1. Wybierz SRT i audio/wideo (obsługiwane są również kontenery MPEG-2: `.mpg`, `.mpeg`, `.m2v`, `.m2t`, `.mts`, `.m2ts`, `.ts` i `.vob`) albo wyeksportuj miks WAV przy użyciu własnego presetu EPR.
2. Wybierz tryb dokładny albo szybki i kliknij **Analizuj i dopasuj**.
3. Popraw czasy słów o niskiej pewności.
4. Ustaw wygląd, sposób obsługi przerw i docelową ścieżkę.
5. Pozostaw zaznaczone **Spróbuj automatycznie utworzyć sekwencję overlay z Caption**, a następnie kliknij **Generuj wszystko + sekwencja**. Panel zapisze i zaimportuje W3C TTML, spróbuje utworzyć sekwencję `KARAOKE_OVERLAY` bezpośrednio z tego elementu oraz otworzy ją wyłącznie wtedy, gdy wykryje prawdziwą ścieżkę Caption.
6. Wykonaj ręczne **Upgrade Caption to Graphic** i usuń Caption Track. To jedyny krok, którego oficjalne API UXP nie udostępnia.
7. Kliknij **Zaznacz pierwsze grafiki** lub **Zaznacz ostatnie grafiki** i ręcznie zastosuj wybrany preset Text Animatora tylko do zaznaczonych klipów.
8. Kliknij **Sprawdź rezultat** i zapisz `.karaoke.json`.

## Budowanie i testy

Gotowy runtime znajduje się w `packages/panel/dist`, więc do ładowania deweloperskiego nie jest wymagany build. Kontrola źródeł TypeScript i paczki:

```powershell
npm install
npm run build
npm test
```

Bez instalowania npm można uruchomić testy gotowego runtime Node:

```powershell
node --test packages/shared/tests/*.test.cjs tests/*.test.cjs
cd packages\alignment-service
python -m unittest discover -s tests -v
```

## Pakowanie

UXP Developer Tool potrafi utworzyć podpisywalny pakiet `.ccx`. W tym środowisku UDT nie jest zainstalowany, dlatego dostarczane archiwum ZIP zawiera źródła i gotowy panel deweloperski. Do publikacji użyj w UDT opcji **Package** po nadaniu produkcyjnego identyfikatora i podpisaniu pakietu.

## Prywatność i bezpieczeństwo

- manifest zezwala tylko na `http://127.0.0.1:8765`;
- helper binduje wyłącznie `127.0.0.1`;
- brak klienta chmurowego i brak telemetrii;
- usuwanie klipów wymaga potwierdzenia i dopasowuje wyłącznie docelową ścieżkę oraz dokładne granice zapisanych stanów;
- zapis przez picker systemowy nie nadpisuje pliku bez potwierdzenia użytkownika.
