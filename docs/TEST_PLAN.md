# Test w Premiere 26.3+

## Minimalny proof of concept

1. Otwórz projekt z sekwencją 1920×1080, 25 fps i pustą ścieżką V4.
2. Uruchom helper i panel.
3. Wczytaj `examples\sample.srt`.
4. Wybierz tryb szybki i kliknij `Analizuj i dopasuj`.
5. Sprawdź pięć słów oraz monotoniczne czasy 1,000–4,000 s.
6. Pozostaw włączoną automatyczną sekwencję overlay, kliknij `Generuj wszystko + sekwencja` i zapisz plik.
7. Sprawdź, że panel zaimportował TTML i otworzył `KARAOKE_OVERLAY` tylko wtedy, gdy `getCaptionTrackCount()` potwierdził ścieżkę Caption. Jeżeli host nie obsługuje tworzenia sekwencji z TTML, sprawdź usunięcie pustej sekwencji i czytelny komunikat ręcznego przeciągnięcia.
8. Zaznacz wszystkie Caption i wybierz `Graphics and Titles → Upgrade Caption to Graphic`.
9. Usuń Caption Track.
10. Kliknij `Sprawdź rezultat`.

## Kryteria

- dokładnie pięć klipów na V4;
- pierwszy zaczyna się 1,000 s, ostatni kończy 4,000 s;
- sąsiednie klipy mają wspólną granicę, bez luki i nakładania;
- każdy pokazuje całe zdanie;
- aktywny kolor obejmuje kolejno `Dzisiaj`, `w`, `Szczecinie`, `będzie`, `słonecznie.`;
- interpunkcja nie jest osobnym stanem;
- pozycja, szerokość pola i łamanie nie zmieniają się;
- Caption Track został usunięty;
- każdy klip można niezależnie edytować w Properties;
- `Zaznacz pierwsze grafiki` wybiera tylko pierwszy klip wpisu;
- `Zaznacz ostatnie grafiki` wybiera tylko ostatni klip wpisu;
- preset wejścia zastosowany tylko do pierwszego i wyjścia tylko do ostatniego nie restartuje się pośrodku.

## Forced alignment

Powtórz test z rzeczywistym WAV i trybem dokładnym. Dla słów z pewnością poniżej 50% panel powinien pokazać ostrzeżenie. Zmień ręcznie granicę jednego słowa, zapisz `.karaoke.json`, otwórz go ponownie i potwierdź zachowanie korekty.

## Format i kompatybilność

Powtórz na 23,976; 24; 25; 29,97 i 50 fps. Czasy projektu i TTML są sekundowe, a dopasowanie gotowych grafik korzysta z `TickTime.seconds`; nie są zaokrąglane wyłącznie do numerów klatek.
