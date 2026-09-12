# Visore per la macchina 192.168.1.69

Un mini-browser dedicato: apri l'app sul tuo computer collegato alla rete, lei contatta la macchina al posto tuo e ti mostra la pagina. Poiché la richiesta parte dal programma e non dal browser, non si applicano i blocchi tipici del browser (contenuto non sicuro, richieste bloccate tra siti, avvisi sul certificato).

Nota importante: funziona solo quando l'app gira su un computer che vede la rete locale. Se in futuro la pubblichi online, l'indirizzo 192.168.1.69 non sarà raggiungibile.

## Cosa vedrai

Una sola pagina, con:

- Barra in alto con l'indirizzo (preimpostato `http://192.168.1.69`), campo porta (default 80) e pulsanti Vai / Indietro / Avanti / Ricarica.
- Area principale che mostra la pagina della macchina, a tutta larghezza.
- Pulsante "Accesso": inserisci utente e password; vengono usati per tutte le richieste successive (anche login base tipo router/NAS).
- Barra di stato: esito della richiesta, tempo di risposta e messaggio chiaro se la macchina non risponde (spenta, porta sbagliata, rete diversa).
- Interruttore "mostra codice sorgente" per vedere il contenuto grezzo quando la pagina non si rende bene.

## Come funziona la navigazione

I link, le immagini, i fogli di stile e i moduli della pagina originale vengono riscritti in modo da passare sempre attraverso l'app: cliccando un link interno resti dentro il visore e la cronologia Indietro/Avanti funziona. I link verso l'esterno restano normali link.

Gli script della pagina originale vengono disattivati per sicurezza e stabilità: interfacce semplici (router, stampanti, NAS, telecamere) si vedono bene; pannelli molto dinamici potrebbero mostrare solo la parte statica. In quel caso resta disponibile la vista del codice sorgente.

## Dettagli tecnici

- Recupero lato server con `createServerFn` (`src/lib/proxy.functions.ts`): riceve url, porta, credenziali opzionali; esegue `fetch` con header `Authorization: Basic ...` quando servono; certificati non validi tollerati; timeout 15s.
- Risorse binarie (immagini, css, font) servite da una route server `src/routes/api/public/fetch.ts` che fa da passaparola con il content-type originale, così l'HTML riscritto può puntarci.
- Riscrittura HTML con `<base>` + sostituzione degli attributi `href`/`src`/`action` verso l'endpoint passaparola; rimozione di `<script>` e degli header che impediscono l'inserimento in un riquadro.
- Rendering dentro un `iframe` con `srcDoc` e `sandbox` limitata (solo form e navigazione intercettata), nessun accesso al resto dell'app.
- Credenziali tenute solo nella sessione del browser (non salvate su disco, non inviate altrove); cronologia in stato React.
- `src/routes/index.tsx` diventa il visore; `head()` con titolo e descrizione propri.

## Da confermare

La porta: se non è la 80, basta cambiarla nella barra dell'app, quindi non blocca lo sviluppo.
