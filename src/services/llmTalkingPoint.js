'use strict';

const GEMINI_MODEL = () => process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const GEMINI_API_URL = () =>
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL()}:generateContent`;

async function generateTalkingPoint({ contactName, product, insurer, expiryDate, daysLeft, annualPremium, broker }) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not configured');
    }

    const premiumStr = annualPremium != null && annualPremium !== '' ? `${annualPremium} EUR/Jahr` : 'unbekannt';
    const daysStr = daysLeft != null ? `${daysLeft} Tage` : 'unbekannt';

    const urgencyNote = daysLeft != null && daysLeft <= 30
        ? 'Der Vertrag läuft bald ab — die Dringlichkeit sollte im Ton spürbar sein.'
        : daysLeft != null && daysLeft <= 90
            ? 'Der Vertrag läuft in absehbarer Zeit aus — ein proaktiver, aber entspannter Ton passt hier.'
            : 'Es besteht noch kein akuter Zeitdruck — der Fokus liegt auf früher Kontaktaufnahme.';

    const prompt = `WICHTIG: Antworte ausschließlich auf Deutsch. Die gesamte Ausgabe — jeder Satz, jedes Wort — muss auf Deutsch sein. Verwende keine englischen Wörter oder Ausdrücke, auch nicht einzelne Begriffe.

Du bist ein erfahrener Assistent für Versicherungsmakler und erstellst prägnante, aber inhaltlich vollständige Gesprächsnotizen auf Deutsch für Verlängerungsanrufe. Antworte ausschließlich mit der Notiz selbst — keine Einleitung, keine Anführungszeichen, keine Meta-Kommentare, kein Englisch.

Vertragsdaten für diesen Anruf:
- Kunde: ${contactName || 'unbekannt'}
- Produkt: ${product || 'unbekannt'}
- Versicherer: ${insurer || 'unbekannt'}
- Ablaufdatum: ${expiryDate || 'unbekannt'}
- Verbleibende Tage: ${daysStr}
- Jahresbeitrag: ${premiumStr}
- Zuständiger Makler: ${broker || 'unbekannt'}

${urgencyNote}

Schreibe die Gesprächsnotiz in 4-5 vollständigen Sätzen (keine Stichpunkte, keine Überschriften) und decke dabei Folgendes ab:
1. Anlass des Anrufs und aktueller Vertragsstatus (Produkt, Versicherer, verbleibende Zeit bis Ablauf).
2. Ein konkreter Gesprächsaufhänger — z. B. eine Frage zur aktuellen Zufriedenheit oder ein Hinweis auf mögliche Änderungen im Bedarf des Kunden.
3. Der Jahresbeitrag als Gesprächspunkt (z. B. ob eine Überprüfung oder ein Vergleich sinnvoll sein könnte).
4. Ein konkreter nächster Schritt oder eine Abschlussfrage, mit der der Makler das Gespräch beenden kann.

Beispiel für Ton und Detailtiefe (nicht wortwörtlich übernehmen, nur als Referenz):
"Herr Bauer's Hausratversicherung bei der Allianz läuft in 25 Tagen aus — höchste Zeit für den Anruf. Frage zunächst, ob es in den letzten 12 Monaten größere Änderungen im Haushalt gab (Umzug, Renovierung, neue Wertgegenstände), die die Deckungssumme beeinflussen könnten. Der aktuelle Jahresbeitrag liegt bei 340 EUR — das ist ein guter Moment, um zu prüfen, ob ein anderer Tarif der Allianz oder ein Wechsel sich lohnt. Biete am Ende einen konkreten Termin zur Vertragsüberprüfung in den nächsten Tagen an, um die Verlängerung rechtzeitig abzuschließen."

Halte den Ton professionell, direkt und praxisnah — wie eine Notiz, die ein Kollege für einen anderen Makler geschrieben hat.

Erinnerung: Die komplette Antwort muss auf Deutsch sein, ohne Ausnahme.`;

    const response = await fetch(`${GEMINI_API_URL()}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.6,
                maxOutputTokens: 800,
            },
        }),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API error [${response.status}]: ${errText}`);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
        throw new Error('Gemini returned no talking point text');
    }
    return text;
}

module.exports = { generateTalkingPoint };