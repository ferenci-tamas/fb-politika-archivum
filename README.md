# Magyar közéleti és politikai Facebook-posztok kereshető archívuma, 2008–2026

Összeállította: Ferenci Tamás (<https://www.medstat.hu/>)

## Az archívum weboldala

Az adatokat kereshető, szűrhető, rendezhető formában megjelenítő weboldal a <https://ferenci-tamas.github.io/fb-politika-archivum/> címen érhető el. Itt -- az elemzési lehetőségeket illusztrálandó -- néhány egyszerűbb elemzés is megtalálható, melyek az adatok interaktív vizsgálatát, ábrázolását teszik lehetővé néhány releváns szempont mentén.

## Adatok elérhetősége

A továbbfeldolgozás megkönnyítése érdekében az adatokat nem csak a weboldalon, hanem nyers, gépi úton feldolgozható formátumban is elérhetővé teszem. Az adatok letölthetőek [SQLite](https://fb-politika-archivum.medstat.hu/database/archive.sqlite) adatbázisként (mely minden táblát tartalmaz), vagy táblánként külön-külön, CSV formátumban: [posztok](https://fb-politika-archivum.medstat.hu/database/posts.csv), [linkek](https://fb-politika-archivum.medstat.hu/database/links.csv), illetve [képek](https://fb-politika-archivum.medstat.hu/database/images.csv). A képek fájlnév alapján a `https://fb-politika-archivum.medstat.hu/images/<kep>` címen érhetőek el (ahol a `<kep>` a fájlnevet jelenti).

## Technikai részletek

A Facebook-posztok jogtiszta módon történő letöltését az [Apify](https://apify.com/) segítségével végeztem. A kapott JSON-ökből egy R nyelvű szkripttel szedtem ki a felhasznált információkat. (A szkriptet csak azért nem teszem közzé, mert a formátum olyan gyorsan változik, hogy a végén már nekem is mást kellett használnom mint az elején. Claude-dal vagy hasonló eszközzel gyorsan megírható.) A kapott táblákból egy SQLite adatbázist készítettem (az ehhez használt [szkriptből](https://github.com/ferenci-tamas/fb-politika-archivum/blob/main/SQLite-converter.R) a tábla formátuma is látható). Az adatbázist és a képeket Cloudflare R2-n tároltam. A megjelenítő felület megalkotása messze-messze túlmegy a képességeimen, ezt Claude Opus 4.8 segítségével végeztem (a transzparencia érdekében a használt [promptot](https://github.com/ferenci-tamas/fb-politika-archivum/blob/main/prompt.md) közzéteszem). Az általa készített dokumentáció a [DOCUMENTATION.md](https://github.com/ferenci-tamas/fb-politika-archivum/blob/main/DOCUMENTATION.md) fájlban érhető el.

## Ismert problémák

- A mostani helyett teljes értékűbb lehetne egy Cloudflare D1 + Cloudflare Worker megoldás (csak ahhoz a free tier kevés, már közepes terhelésnél is).
- Ha egy posztnak két szerzője is van (mint például [ennek](https://www.facebook.com/FideszHU/posts/pfbid02uGZj93NBxpGixjZQAtrbAo3AeL1i9BHuyjXMojMxnqjUNWUHaxxPmFC5FTHWEoy3l)), akkor csak az egyiknél jelenik meg. Így a szerzőség nem tökéletes, de cserében nincsenek posztbeli duplikálódások.
- Képek lehetnének jobb minőségűek is (a scrape-elés sajnos csak a rosszabb minőséget hozta).
- Az URL jelenlegi elérhetőségének vizsgálata nem tökéletes: ha redirectel, de valami teljesen másra, az is jónak fog tűnni.

## Továbbfejlesztési lehetőségek

- Videók kérdése (1,5 TB, ennek érdemi költsége lenne zero egress cost-tal együtt is, pusztán tárhely miatt).
- Fényképek leírása, videók feliratozása (majd szöveges vizsgálatok ezek alapján is).
- Politikusok csoportosítása politikai pártok, politikai pártok csoportosítása kormányzat/ellenzék státusz szerint és politikai nézetrendszer szerint (ez utóbbi kérdőjeles, mert szemben az előbbi kettővel, nem tökéletesen objektív).
- Vector database alkalmazása?
- Spline simítás alkalmazása a grafikonokon a havi bontás helyett.