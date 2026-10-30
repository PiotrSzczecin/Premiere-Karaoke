# Raport ograniczeń oficjalnego API Premiere UXP 26.3

Sprawdzenie wykonano 19 sierpnia 2026 na aktualnej dokumentacji Adobe, oficjalnych przykładach i deklaracjach `adobe/premierepro-types`.

## Dostępne i użyte

- `Project.getActiveProject()` i `Project.getActiveSequence()`;
- `Sequence.getFrameSize()`, `getSettings()`, `getVideoTrackCount()`, `getAudioTrackCount()`;
- `TickTime.createWithSeconds()` i wartości ticks zapisane w manifeście stanów;
- `Project.importFiles()` do importu TTML;
- `VideoTrack.getTrackItems()` oraz czasy klipów do dopasowania po konwersji;
- `TrackItemSelection.createEmptySelection()` i `Sequence.setSelection()`;
- `SequenceEditor.createRemoveItemsAction()` w transakcji do ostrożnego usuwania dopasowanych klipów;
- `EncoderManager.exportSequence()` z wybranym przez użytkownika presetem EPR do eksportu miksu.

## Brak w publicznej powierzchni 26.3

W oficjalnym pliku `premierepro.d.ts` nie ma typu ani fabryki `Graphic`, metody `createText`, edycji zakresów stylu tekstu ani konfiguracji Text Animatora. `CaptionTrack` pozwala tylko odczytać elementy, nazwę/indeks oraz mute; nie tworzy ścieżki ani segmentów. Nie ma też publicznego wywołania menu **Upgrade Caption to Graphic**.

Z tego powodu nie da się uczciwie zrealizować całego przepływu wyłącznie automatycznym UXP 26.3 bez prywatnego API, QE DOM, symulowania klawiatury albo innej niedokumentowanej metody. Projekt żadnej z nich nie używa.

## Zastosowany fallback

Panel generuje TTML, gdzie każdy segment jest pełnym zdaniem i posiada osobne `<span>` dla tekstu bazowego, przeczytanego oraz aktywnego. Użytkownik wykonuje w Premiere import na Caption Track i jedno polecenie **Upgrade Caption to Graphic** dla zaznaczonych segmentów, następnie usuwa ścieżkę Caption. Wynik jest zestawem niezależnych grafik.

## Text Animator

Panel zapisuje zamierzony preset/czas animacji i potrafi zaznaczyć wszystkie pierwsze albo ostatnie grafiki na podstawie dokładnych czasów. Sam preset trzeba zastosować ręcznie. Środkowe stany nie są zaznaczane, więc animator nie uruchamia się ponownie przy zmianie słowa.

Jeśli pierwszy lub ostatni stan jest krótszy niż ustawiona animacja, użytkownik powinien skrócić preset do czasu klipu. Panel nie zmienia synchronizacji słów.

## Co trzeba zweryfikować po aktualizacji do 26.3

- czy importer TTML zachowuje kolor `<span>`, font, obrys, cień, tło i `lineHeight` w danej wersji Premiere;
- czy Upgrade Caption to Graphic zachowuje polskie znaki i ręczne `<br/>`;
- czy granice klipów po konwersji pozostają z dokładnością co najmniej 3 ms;
- czy Text Animator zastosowany do wielu zaznaczonych klipów zachowuje czasy;
- czy natywny panel Properties pozwala edytować pojedynczą grafikę bez wpływu na pozostałe.

Jeżeli Premiere nie zachowa części stylów TTML, panel nadal tworzy poprawne czasy i treść, ale brakujące parametry trzeba ustawić zbiorczo po konwersji. Publiczne UXP 26.3 nie daje sposobu programowego obejścia tego zachowania.

## Oficjalne źródła

- https://developer.adobe.com/premiere-pro/uxp/ppro-reference/
- https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/captiontrack/
- https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequenceeditor/
- https://github.com/adobe/premierepro-types/blob/main/src/premierepro.d.ts
- https://github.com/AdobeDocs/uxp-premiere-pro-samples
