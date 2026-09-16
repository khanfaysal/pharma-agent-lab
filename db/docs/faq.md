---
title: Frequently Asked Questions
source_type: faq
uri: https://medindex.example/help/faq
effective: 2026-03-01
---

# Frequently Asked Questions

## Searching

### How do I search by generic name versus brand name?
Type either one — search matches both. A generic name is the active ingredient
(for example *Paracetamol*, *Omeprazole*, *Metformin Hydrochloride*). A brand
name is the manufacturer's trade name for a specific pack (for example *Napa*,
*Seclo*, *Comet*). Results group brands under their generic so you can see every
equivalent product at once. Use the **Generic** / **Brand** toggle above the
results list to restrict to one or the other.

### How do I find the cheapest equivalent of a medicine?
Search the brand name, open its record, and use **See all brands of this
generic**. The list is sortable by unit price. Remember that price is per the
pack size shown — a 100's pack at BDT 120 is cheaper per tablet than a 10's pack
at BDT 15. The AI assistant can do this comparison for you: ask "what is the
cheapest alternative to Napa 500mg?"

### Why do two brands with the same generic have very different prices?
Pack size, strength, dosage form, and manufacturer all move the price.
Injections and modified-release forms cost substantially more than plain
tablets. A price that looks anomalous is often a different strength.

### Can I search by manufacturer?
Yes. Search the company name to see everything they market, or filter an
existing result set by company. Company pages show brand count, generic count,
and price range.

### Can I search by what a medicine treats?
Yes — search an indication such as "hypertension" or "bacterial conjunctivitis".
Indications are linked to generics, so you get the active ingredients used for
that condition and then their brands. You can also browse by therapeutic class
and body system.

### What is a therapeutic class versus a systemic class?
Systemic class is the broad body system (Cardiovascular, Central Nervous System,
Gastrointestinal). Therapeutic class is the narrower drug family within it
(Beta-blockers, Proton pump inhibitors). One generic can belong to several
therapeutic classes.

### Search returns nothing — what now?
Check the spelling; the search tolerates one or two character errors but not
more. Try the generic name instead of the brand. Some older or discontinued
products are not in the database. Herbal and traditional products are held in a
separate section — switch to the **Herbal** tab.

## Medicine records

### What is a pregnancy category?
A letter grade (A, B, C, D, X) summarising known risk in pregnancy. A is safest,
X is contraindicated. The letter is a summary, not a decision — read the
accompanying note and consult a clinician.

### What does "renal dose" mean?
The adjusted dose for patients with reduced kidney function, usually expressed
against creatinine clearance. If a monograph has no renal dose, that does not
mean no adjustment is needed — it means the manufacturer's summary did not
publish one.

### Why does a monograph have blank sections?
Records are compiled from manufacturer submissions of varying completeness. A
blank contraindications field means "not supplied", never "none".

### What are herbal medicines here?
Traditional, ayurvedic, and unani preparations registered separately from
allopathic drugs. They have composition and description fields instead of the
full clinical monograph structure, because the underlying regulatory submissions
differ.

## The AI assistant

### What can the assistant do?
It answers questions about the database in plain language. It can look up
structured facts (prices, manufacturers, strengths, brand counts), retrieve
passages from these help and policy documents, and combine both. Every answer
cites what it used.

### Why does it sometimes take longer?
Complex questions need several steps: decide what to look up, run a database
query, retrieve supporting passages, then write the answer. Simple lookups take
one step.

### Can it prescribe or tell me what to take?
No. It will refuse dosing decisions for a specific person and redirect you to a
clinician. It reports what the label says; it does not apply it to you.

### Is it ever wrong?
Yes. It is a language model over a retrieval system and both layers can fail —
it can retrieve the wrong passage, or misread a correct one. Check the citations
against the linked records. Report bad answers with the thumbs-down control;
those go into our evaluation set.

### What does the model badge on an answer mean?
It shows which model produced the answer and how the question was routed. Cheap
factual lookups go to a fast model; multi-step reasoning goes to a stronger one.

## Accounts and data

### Is it free?
Core search and browsing are free. Free accounts get 30 assistant messages per
hour. Institutional plans lift the limits and add bulk export.

### Do I need an account?
Not for search. Yes for the assistant, saved lists, and export.

### How do I delete my data?
Settings → Privacy → Delete account, or email privacy@medindex.example. Your
account record is removed and search history de-identified within 30 days.

### Do you sell my data?
No. See the Privacy Policy. Sponsorship is sold on aggregate impressions only.

### How current is the data?
Brand and price records are refreshed on a rolling monthly cycle. Monographs are
updated when a manufacturer files a revision. The record page shows a last-updated
date.

## Technical

### Is there an API?
Yes, for institutional plans. REST, JSON, key-based auth, 10 requests/second.
Contact api@medindex.example.

### Can I scrape the site?
No — see Terms section 3. Use the API.

### Which browsers are supported?
Current and previous major versions of Chrome, Edge, Firefox, and Safari.
