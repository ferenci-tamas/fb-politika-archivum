
<!-- FIGYELEM: a fájl NEM szerkeszthető közvetlenül, csak a README.Rmd fájlon keresztül!
Fordítás: callr::r(function(input, toconvert) rmarkdown::render(input, params = list(toconvert = toconvert)), args = list("README.Rmd", toconvert)) -->

# Magyar közéleti és politikai Facebook-posztok kereshető archívuma, 2008–2026

Összeállította: Ferenci Tamás (<https://www.medstat.hu/>)

## Az archívum weboldala

Az adatokat kereshető, szűrhető, rendezhető formában megjelenítő weboldal a <https://ferenci-tamas.github.io/fb-politika-archivum/> címen érhető el. Itt – az elemzési lehetőségeket illusztrálandó – néhány egyszerűbb elemzés is megtalálható, melyek az adatok interaktív vizsgálatát, ábrázolását teszik lehetővé néhány releváns szempont mentén.

## Adatok elérhetősége

A továbbfeldolgozás megkönnyítése érdekében az adatokat nem csak a weboldalon, hanem nyers, gépi úton feldolgozható formátumban is elérhetővé teszem. Az adatok letölthetőek [SQLite](https://fb-politika-archivum.medstat.hu/database/archive.sqlite) adatbázisként (mely minden táblát tartalmaz), vagy táblánként külön-külön, CSV formátumban: [posztok](https://fb-politika-archivum.medstat.hu/database/posts.csv), [linkek](https://fb-politika-archivum.medstat.hu/database/links.csv), illetve [képek](https://fb-politika-archivum.medstat.hu/database/images.csv). A képek fájlnév alapján a `https://fb-politika-archivum.medstat.hu/images/<kep>` címen érhetőek el (ahol a `<kep>` a fájlnevet jelenti).

## Az archívum tartalma

Az archívum 721 256 posztot tartalmaz 119 szerzőtől; az első archivált poszt dátuma 2008. április 29., az utolsóé 2026. április 18. (a cél a kezdetektől 2026 április közepéig történő archiválás volt). A posztokban összesen 645 644 kép (együttes méretük: 28 GB), 102 757 videó (együttes méretük: 1383 GB) és 212 372 link található.

A következő táblázat mutatja az archivált oldalak legfontosabb adatait (a nyílra kattintva megjeleníthető/elrejthető a táblázat).

<details>
<summary>Archivált oldalak adatai</summary>

| Szerző | Első poszt dátuma | Utolsó poszt dátuma | Posztok száma | Képek száma | Képek mérete \[MB\] | Videók száma | Videók mérete \[GB\] | Linkek száma |
|:---|:---|:---|---:|---:|---:|---:|---:|---:|
| Bajnai Gordon | 2009\. 12. 18. | 2026\. 04. 13. | 627 | 387 | 18.4 | 9 | 0.1 | 375 |
| Balog Zoltán | 2012\. 11. 14. | 2025\. 12. 20. | 2 812 | 5 875 | 226.7 | 85 | 3.4 | 1 332 |
| Barabás Richárd | 2013\. 08. 19. | 2026\. 04. 13. | 2 725 | 2 159 | 102.6 | 325 | 4.3 | 886 |
| Botka László | 2010\. 11. 25. | 2026\. 04. 18. | 5 050 | 4 485 | 221.0 | 227 | 4.5 | 2 893 |
| Budai Gyula | 2020\. 03. 05. | 2026\. 04. 18. | 1 588 | 713 | 26.1 | 402 | 4.2 | 88 |
| Bánki Erik | 2025\. 10. 02. | 2026\. 04. 13. | 358 | 125 | 7.0 | 214 | 2.5 | 1 |
| Bányai Gábor | 2023\. 02. 09. | 2026\. 04. 16. | 4 864 | 6 786 | 306.4 | 960 | 15.6 | 162 |
| Bóka János | 2023\. 09. 03. | 2026\. 04. 12. | 2 836 | 3 848 | 145.5 | 1 071 | 10.6 | 47 |
| Cseh Katalin | 2015\. 05. 12. | 2026\. 04. 12. | 3 548 | 2 966 | 123.4 | 480 | 9.0 | 970 |
| Cser-Palkovics András | 2018\. 10. 03. | 2026\. 04. 18. | 4 314 | 8 469 | 368.7 | 324 | 7.1 | 609 |
| Czepek Gábor | 2025\. 03. 07. | 2026\. 04. 17. | 1 440 | 1 148 | 47.2 | 571 | 4.5 | 29 |
| Czunyiné Bertalan Judit | 2022\. 06. 25. | 2026\. 04. 18. | 4 999 | 9 312 | 369.9 | 652 | 10.6 | 263 |
| Demokratikus Koalíció | 2011\. 11. 09. | 2026\. 04. 17. | 28 751 | 10 043 | 470.3 | 1 857 | 24.0 | 16 183 |
| Deutsch Tamás | 2024\. 02. 10. | 2026\. 04. 17. | 3 606 | 1 845 | 89.3 | 1 133 | 11.1 | 60 |
| Dobrev Klára | 2018\. 09. 14. | 2026\. 04. 17. | 5 113 | 4 681 | 205.2 | 1 438 | 23.2 | 661 |
| Donáth Anna | 2017\. 11. 19. | 2024\. 10. 23. | 3 123 | 1 981 | 87.7 | 375 | 8.5 | 1 081 |
| Dömötör Csaba | 2020\. 05. 28. | 2026\. 04. 17. | 3 967 | 3 421 | 154.5 | 1 555 | 16.4 | 210 |
| Energiaügyi Minisztérium | 2023\. 05. 15. | 2026\. 04. 10. | 1 265 | 2 109 | 97.8 | 75 | 1.3 | 85 |
| Fazekas Sándor | 2016\. 11. 23. | 2026\. 04. 12. | 2 023 | 3 277 | 150.1 | 27 | 0.8 | 43 |
| Fekete-Győr András | 2017\. 11. 20. | 2026\. 04. 17. | 3 212 | 2 605 | 116.6 | 446 | 8.3 | 582 |
| Ferencz Orsolya | 2017\. 10. 06. | 2026\. 04. 15. | 4 925 | 2 011 | 92.7 | 938 | 8.9 | 737 |
| Fidesz | 2008\. 04. 29. | 2026\. 04. 16. | 39 269 | 18 745 | 931.2 | 8 070 | 39.2 | 5 569 |
| Fodor Gábor | 2012\. 01. 16. | 2026\. 04. 18. | 4 540 | 1 866 | 78.2 | 26 | 0.3 | 3 212 |
| Font Sándor | 2022\. 03. 28. | 2026\. 04. 12. | 5 000 | 4 362 | 211.3 | 633 | 6.4 | 129 |
| Főváros átvilágítási szakértő | 2025\. 06. 19. | 2025\. 11. 24. | 33 | 27 | 1.1 | 2 | 0.0 | 0 |
| Gulyás Gergely | 2014\. 06. 03. | 2026\. 04. 12. | 4 263 | 5 938 | 227.7 | 858 | 11.9 | 353 |
| Gyurcsány Ferenc | 2011\. 02. 16. | 2026\. 04. 17. | 5 206 | 3 542 | 167.0 | 725 | 10.2 | 1 049 |
| György László | 2018\. 07. 11. | 2026\. 04. 17. | 2 878 | 3 891 | 157.1 | 448 | 4.5 | 353 |
| Hadházy Ákos | 2014\. 01. 29. | 2026\. 04. 12. | 9 442 | 11 871 | 819.2 | 414 | 17.2 | 8 178 |
| Hankó Balázs | 2023\. 01. 11. | 2026\. 04. 12. | 3 825 | 5 501 | 203.5 | 1 397 | 18.6 | 216 |
| Hiller István | 2016\. 01. 13. | 2026\. 04. 13. | 1 815 | 95 | 4.3 | 81 | 1.0 | 1 251 |
| Hollik István | 2017\. 12. 21. | 2026\. 04. 16. | 4 608 | 2 750 | 133.6 | 971 | 10.6 | 317 |
| Hoppál Péter | 2023\. 08. 03. | 2026\. 04. 18. | 4 598 | 5 550 | 266.2 | 513 | 5.5 | 260 |
| Hornung Ágnes | 2022\. 07. 05. | 2026\. 03. 10. | 1 083 | 1 693 | 71.2 | 150 | 3.0 | 48 |
| Horváth László | 2021\. 02. 18. | 2026\. 04. 15. | 4 368 | 5 756 | 286.4 | 945 | 7.2 | 105 |
| Ildiko Lendvai | 2013\. 10. 25. | 2026\. 04. 18. | 4 668 | 486 | 20.9 | 1 | 0.0 | 2 020 |
| Innovációs és Technológiai Minisztérium | 2021\. 06. 01. | 2022\. 06. 01. | 25 | 28 | 1.2 | 1 | 0.0 | 8 |
| Jobbik Magyarországért Mozgalom | 2010\. 04. 02. | 2026\. 04. 05. | 21 709 | 11 541 | 528.1 | 3 151 | 39.4 | 8 936 |
| Joó István | 2021\. 05. 11. | 2026\. 04. 12. | 1 026 | 2 292 | 79.4 | 137 | 2.1 | 58 |
| Juhász Péter | 2013\. 05. 02. | 2026\. 04. 18. | 3 548 | 1 980 | 103.3 | 894 | 17.5 | 4 655 |
| Jámbor András | 2019\. 11. 12. | 2026\. 04. 18. | 6 802 | 3 459 | 177.3 | 1 511 | 21.0 | 1 474 |
| Jávor Benedek | 2010\. 11. 15. | 2026\. 04. 18. | 4 325 | 1 379 | 63.4 | 120 | 4.1 | 2 620 |
| KDNP | 2009\. 12. 18. | 2026\. 04. 18. | 35 220 | 14 676 | 591.4 | 1 452 | 13.2 | 8 148 |
| Kanász-Nagy Máté | 2014\. 11. 13. | 2026\. 04. 18. | 3 427 | 2 309 | 105.6 | 698 | 28.8 | 1 832 |
| Karácsony Gergely | 2011\. 07. 11. | 2026\. 04. 18. | 9 621 | 10 362 | 465.4 | 1 093 | 15.6 | 3 905 |
| Keresztes László Lóránt | 2014\. 01. 23. | 2026\. 04. 18. | 6 642 | 5 649 | 268.7 | 629 | 31.4 | 2 604 |
| Király Nóra | 2014\. 10. 31. | 2026\. 04. 17. | 7 779 | 8 812 | 435.4 | 1 389 | 15.1 | 1 856 |
| Kocsis Máté | 2009\. 09. 26. | 2026\. 04. 12. | 8 057 | 4 374 | 191.3 | 1 372 | 12.8 | 3 007 |
| Komjáthi Imre | 2013\. 12. 01. | 2026\. 04. 18. | 6 632 | 5 819 | 264.8 | 427 | 13.2 | 3 386 |
| Kovács Zoltán | 2021\. 04. 03. | 2026\. 04. 12. | 5 000 | 4 248 | 191.6 | 1 070 | 10.5 | 167 |
| Kubatov Gábor | 2010\. 01. 18. | 2026\. 04. 12. | 4 851 | 4 137 | 198.5 | 899 | 4.9 | 301 |
| Kunhalmi Ágnes | 2013\. 05. 12. | 2026\. 04. 18. | 4 897 | 6 416 | 268.9 | 178 | 4.0 | 1 372 |
| Kósa Lajos | 2012\. 06. 17. | 2026\. 04. 12. | 3 089 | 6 110 | 306.0 | 808 | 11.7 | 606 |
| Kósa Ádám | 2021\. 04. 02. | 2026\. 04. 17. | 4 647 | 2 650 | 125.3 | 752 | 6.5 | 249 |
| LMP - Magyarország Zöld Pártja | 2009\. 01. 28. | 2026\. 03. 15. | 16 496 | 7 439 | 307.4 | 1 536 | 33.5 | 12 355 |
| Lezsák Sándor | 2017\. 10. 04. | 2026\. 04. 13. | 5 334 | 10 416 | 480.2 | 831 | 10.8 | 315 |
| Liberálisok | 2013\. 04. 24. | 2022\. 11. 27. | 6 419 | 1 848 | 80.5 | 195 | 2.9 | 4 706 |
| Lánczi Tamás | 2024\. 01. 10. | 2026\. 04. 09. | 767 | 366 | 15.1 | 258 | 4.3 | 160 |
| László András | 2024\. 04. 10. | 2026\. 04. 16. | 1 451 | 800 | 38.4 | 370 | 3.6 | 31 |
| Lázár János | 2018\. 03. 01. | 2026\. 04. 12. | 5 579 | 6 335 | 239.8 | 1 955 | 35.3 | 297 |
| Magyar Kétfarkú Kutya Párt | 2009\. 02. 25. | 2026\. 04. 17. | 12 222 | 5 867 | 314.5 | 916 | 28.7 | 6 409 |
| Magyar Péter | 2010\. 05. 01. | 2026\. 04. 18. | 3 078 | 2 858 | 134.1 | 658 | 18.7 | 54 |
| Magyar Szocialista Párt | 2010\. 09. 19. | 2026\. 04. 18. | 22 458 | 11 109 | 531.2 | 3 106 | 42.6 | 15 960 |
| Magyarország Kormánya | 2011\. 01. 20. | 2026\. 04. 12. | 25 530 | 21 884 | 948.1 | 5 332 | 31.9 | 7 849 |
| Menczer Tamás | 2019\. 03. 05. | 2026\. 04. 13. | 6 644 | 3 870 | 183.0 | 2 473 | 30.2 | 154 |
| Mesterházy Attila | 2021\. 07. 07. | 2026\. 04. 18. | 9 954 | 7 430 | 306.5 | 351 | 5.0 | 1 091 |
| Mi Hazánk Mozgalom | 2022\. 05. 06. | 2026\. 04. 18. | 3 979 | 2 281 | 99.3 | 424 | 10.8 | 883 |
| Molnár Csaba | 2011\. 12. 14. | 2026\. 04. 18. | 3 865 | 1 805 | 86.6 | 223 | 4.4 | 1 367 |
| Molnár Gyula | 2010\. 09. 04. | 2026\. 04. 11. | 1 560 | 1 299 | 67.1 | 107 | 1.5 | 427 |
| Momentum Mozgalom | 2017\. 01. 10. | 2026\. 04. 18. | 12 844 | 6 097 | 268.4 | 1 161 | 16.0 | 4 894 |
| Márki-Zay Péter | 2018\. 01. 02. | 2026\. 04. 18. | 8 892 | 7 885 | 360.8 | 1 408 | 31.1 | 2 952 |
| Nagy István | 2013\. 10. 30. | 2026\. 04. 13. | 12 000 | 20 305 | 845.4 | 1 555 | 18.5 | 1 969 |
| Nagy Márton | 2025\. 01. 01. | 2026\. 04. 11. | 1 093 | 1 161 | 46.9 | 198 | 2.0 | 16 |
| Navracsics Tibor | 2020\. 09. 08. | 2026\. 04. 12. | 4 951 | 12 476 | 432.1 | 614 | 5.4 | 224 |
| Nemzetgazdasági Minisztérium | 2020\. 01. 06. | 2026\. 04. 08. | 1 039 | 547 | 23.1 | 65 | 0.7 | 425 |
| Novák Katalin | 2014\. 08. 28. | 2025\. 05. 04. | 6 621 | 10 012 | 409.6 | 789 | 17.1 | 1 288 |
| Németh Balázs | 2020\. 09. 15. | 2026\. 04. 12. | 3 136 | 1 625 | 75.6 | 1 536 | 13.1 | 41 |
| Németh Szilárd | 2014\. 05. 26. | 2026\. 04. 13. | 14 573 | 11 893 | 576.5 | 486 | 9.3 | 4 202 |
| Orbán Balázs | 2025\. 02. 19. | 2026\. 04. 18. | 3 695 | 3 115 | 137.4 | 1 462 | 15.4 | 111 |
| Orbán Viktor | 2010\. 01. 25. | 2026\. 04. 12. | 9 279 | 11 851 | 420.3 | 3 585 | 44.5 | 436 |
| Ovádi Péter | 2021\. 06. 24. | 2026\. 04. 16. | 5 000 | 9 636 | 368.9 | 807 | 7.2 | 182 |
| Palkovics László | 2025\. 03. 17. | 2026\. 04. 12. | 483 | 1 449 | 49.6 | 76 | 1.0 | 6 |
| Pál Norbert | 2019\. 02. 05. | 2026\. 04. 17. | 701 | 1 635 | 87.3 | 27 | 0.2 | 73 |
| Pálinkás József | 2020\. 10. 13. | 2026\. 04. 13. | 1 204 | 1 003 | 47.4 | 17 | 0.5 | 225 |
| Párbeszéd Magyarországért Budapest | 2013\. 02. 09. | 2021\. 12. 11. | 2 515 | 49 | 2.6 | 0 | 0.0 | 2 738 |
| Pócs János | 2022\. 11. 19. | 2026\. 04. 18. | 3 914 | 6 621 | 276.7 | 1 050 | 16.9 | 90 |
| Rétvári Bence | 2023\. 04. 29. | 2026\. 04. 13. | 4 305 | 5 167 | 210.2 | 1 189 | 10.1 | 48 |
| Rókusfalvy Pál | 2022\. 12. 12. | 2026\. 04. 17. | 722 | 1 036 | 47.5 | 119 | 1.3 | 225 |
| Sallai Róbert Benedek | 2014\. 03. 24. | 2026\. 04. 13. | 3 068 | 1 019 | 47.2 | 12 | 0.2 | 2 739 |
| Schiffer András | 2010\. 01. 23. | 2026\. 04. 18. | 7 726 | 1 134 | 54.3 | 24 | 1.3 | 5 480 |
| Schmidt Ádám | 2022\. 06. 22. | 2026\. 04. 11. | 2 027 | 4 413 | 170.4 | 428 | 5.7 | 132 |
| Semjén Zsolt | 2011\. 10. 07. | 2026\. 04. 12. | 2 675 | 3 030 | 124.5 | 240 | 4.5 | 1 023 |
| Seszták Miklós | 2010\. 01. 30. | 2026\. 04. 12. | 10 413 | 19 611 | 788.6 | 976 | 11.7 | 1 404 |
| Simicskó István | 2015\. 05. 20. | 2026\. 04. 12. | 7 877 | 9 115 | 381.9 | 1 126 | 19.3 | 491 |
| Simon Miklós | 2017\. 05. 23. | 2026\. 04. 12. | 9 285 | 17 660 | 679.0 | 867 | 7.6 | 1 445 |
| Sulyok Tamás | 2024\. 03. 06. | 2026\. 04. 12. | 1 359 | 2 341 | 98.9 | 310 | 5.4 | 11 |
| Szabó Rebeka | 2011\. 07. 13. | 2026\. 04. 17. | 4 017 | 2 470 | 124.2 | 161 | 4.6 | 1 938 |
| Szabó Tímea | 2011\. 09. 03. | 2026\. 04. 18. | 6 037 | 3 027 | 140.7 | 386 | 9.3 | 3 092 |
| Szabó Tünde | 2020\. 07. 29. | 2026\. 04. 14. | 4 715 | 11 397 | 527.0 | 279 | 3.3 | 683 |
| Szalay-Bobrovniczky Kristóf | 2022\. 06. 15. | 2026\. 04. 12. | 2 865 | 4 600 | 177.8 | 882 | 6.3 | 75 |
| Szentkirályi Alexandra | 2019\. 12. 22. | 2026\. 04. 12. | 6 811 | 6 852 | 292.1 | 2 246 | 26.5 | 451 |
| Szijjártó Péter | 2020\. 02. 06. | 2026\. 04. 12. | 10 109 | 18 735 | 615.9 | 3 684 | 45.4 | 104 |
| Szuverenitásvédelmi Hivatal | 2024\. 02. 01. | 2026\. 04. 11. | 1 068 | 230 | 9.5 | 330 | 2.4 | 304 |
| Szél Bernadett | 2012\. 01. 28. | 2026\. 04. 17. | 9 934 | 6 917 | 306.4 | 490 | 13.3 | 6 658 |
| Sára Botond | 2016\. 05. 18. | 2026\. 04. 12. | 4 227 | 4 574 | 196.0 | 327 | 4.1 | 446 |
| Süli János | 2020\. 01. 12. | 2026\. 04. 12. | 3 964 | 4 660 | 205.1 | 445 | 3.7 | 266 |
| Takács Péter | 2022\. 09. 22. | 2026\. 04. 12. | 2 134 | 2 730 | 107.2 | 712 | 6.1 | 88 |
| Tuzson Bence | 2013\. 11. 17. | 2026\. 04. 12. | 6 969 | 11 046 | 466.6 | 1 016 | 6.9 | 1 045 |
| Tóth Bertalan | 2013\. 11. 08. | 2026\. 04. 17. | 6 822 | 2 582 | 117.0 | 825 | 28.3 | 4 766 |
| Ujhelyi István | 2013\. 11. 11. | 2026\. 04. 18. | 13 584 | 8 576 | 418.3 | 400 | 13.5 | 5 232 |
| Vajda Zoltán | 2016\. 10. 14. | 2026\. 04. 17. | 4 851 | 3 410 | 164.8 | 609 | 38.4 | 1 404 |
| Varga Judit | 2018\. 06. 12. | 2026\. 04. 11. | 4 170 | 5 947 | 238.3 | 438 | 4.7 | 457 |
| Varga Mihály | 2010\. 02. 09. | 2026\. 04. 07. | 4 391 | 8 816 | 354.5 | 686 | 8.9 | 220 |
| Vitályos Eszter | 2018\. 11. 22. | 2026\. 04. 12. | 10 978 | 14 522 | 625.0 | 1 524 | 13.9 | 471 |
| Vona Gábor | 2009\. 12. 30. | 2026\. 04. 18. | 8 589 | 5 918 | 255.7 | 1 271 | 24.0 | 3 557 |
| Wintermantel Zsolt | 2021\. 10. 23. | 2026\. 04. 15. | 5 000 | 2 543 | 139.6 | 504 | 7.7 | 361 |
| Zsigmond Barna Pál | 2024\. 07. 05. | 2026\. 04. 18. | 4 032 | 4 077 | 174.3 | 949 | 8.8 | 185 |
| Zsigó Róbert | 2022\. 04. 29. | 2026\. 04. 16. | 5 000 | 7 665 | 348.1 | 750 | 6.0 | 54 |
| Áder János | 2012\. 06. 05. | 2020\. 01. 27. | 217 | 297 | 12.0 | 2 | 0.1 | 46 |

</details>

## Mit tegyek, ha szeretnék én is hozzájárulni ezen adatok biztonságos megőrzéséhez az utókor számára?

A válasz nagyon egyszerű: töltsd le az SQLite formátumú adatbázist! [Ezen a linken](https://fb-politika-archivum.medstat.hu/database/archive.sqlite) megteheted; a mérete jelenleg kb. 799 MB. Ez az adatbázis tartalmazza az összes szöveges adatot (ezen túl pedig a hivatkozásokat a képekre, amik maguk nem részei az adatbázisnak, méretük miatt). Ezen felül, ha használsz Github-ot, érdemes lehet fork-olni ezt a repozitóriumot is (vagy [letölteni ZIP-ben](https://github.com/ferenci-tamas/fb-politika-archivum/archive/refs/heads/main.zip)).

Hogy miért jó mindez? A digitális archiválás – de igazából minden típusú archiválás – egyik alapmegállapítása, hogy egy anyag annál biztonságosabban van megőrizve, minél több, egymástól független (más helyen, más által őrzött) példányban van meg. (Egy amerikai projekt a nevét is erről kapta: LOCKSS – “lots of copies keep stuff safe”, nagyjából: sok másolattal biztonságban vannak a dolgok). Ezért jó, ha az adatbázis minél több helyen, minél több embernél megvan. (Ilyenkor a hitelesség kérdése fontossá válik, erre mindjárt kitérek.)

## Technikai részletek

A Facebook-posztok jogtiszta módon történő letöltését az [Apify](https://apify.com/) segítségével végeztem. A kapott JSON-ökből egy R nyelvű szkripttel szedtem ki a felhasznált információkat. (A szkriptet csak azért nem teszem közzé, mert a formátum olyan gyorsan változik, hogy a végén már nekem is mást kellett használnom mint az elején. Claude-dal vagy hasonló eszközzel gyorsan megírható.) A kapott táblákból egy [SQLite](https://en.wikipedia.org/wiki/SQLite) formátumú adatbázist készítettem (az ehhez használt [szkriptből](SQLite-converter.R) a tábla formátuma is látható). Az SQLite azért célszerű választás, mert jól standardizált, széleskörben használt formátum, ami [kifejezetten ajánlott](https://sqlite.org/locrsf.html) adatbázisok hosszútávú megőrzéséhez. (Ez azért fontos, nehogy a jövőben az legyen a probléma, hogy hiába is van meg az adat, a formátuma nem ismert.)

Az adatbázist és a képeket [Cloudflare R2](https://www.cloudflare.com/products/r2/)-n tároltam.

A megjelenítő felület megalkotása messze-messze túlmegy a képességeimen, ezt Claude Opus 4.8 segítségével végeztem (a transzparencia érdekében a használt [promptot](prompt.md) közzéteszem). Az általa készített dokumentáció a [DOCUMENTATION.md](DOCUMENTATION.md) fájlban érhető el.

## Az archívum hitelesítése

Digitális archívumoknál fontos kérdés a hitelesség is, tehát annak garantálása, hogy a tartalma valóban megfelel az archivált oldalak archiváláskori állapotának, azt nem módosították utólag. E cél elérése érdekében közzéteszem az `archive.sqlite` összes publikált változatának [MD5 lenyomatát](https://en.wikipedia.org/wiki/MD5), ami lehetővé teszi ezt a hitelesítést: ha valaki egy olyan fájllal találkozik, ami azt állítja magáról, hogy ez az archívum, akkor nincs más dolga, mint kiszámolni a lenyomatát, és összevetni a lenti táblázatban szereplő értékkel. (Az ilyen lenyomatoknak ugyanis megvan az a tulajdonságuk, hogy ha módosítják a fájlt, akkor praktikusan nulla annak a valószínűsége, hogy a lenyomat nem változik, és szintén lényegében lehetetlen célirányosan keresni olyan hamisított fájlt, aminek pont egy adott érték lenne a lenyomata.)

| Időbélyeg  |   Méret   |           MD5 lenyomat           |
|:----------:|:---------:|:--------------------------------:|
| 1790842817 | 758960128 | eb1884b4890c545ecb7062adb83d2c79 |
| 1790843311 | 758960128 | abaae760497c144a22414654efe071fa |
| 1790875619 | 719568896 | d05974866a07fa6153974105cb9adf20 |
| 1790928489 | 832913408 | f58161592c8d2d0d06e42895284a817a |
| 1790933403 | 832913408 | ce5068d2b349e7f15e7590450aa8c9d7 |
| 1790964387 | 832913408 | 08b24bf12f5da3360cbd3516d54197c1 |
| 1793134806 | 842956800 | 5f74082fe2e315ee7c4b4b3a7e54d0d4 |
| 1793143343 | 838008832 | 7e3b609580898d0606e50eb291a15731 |
| 1793150139 | 837730304 | 036f1bdf71347dc774465318da9ddc90 |

(Szigorúan véve ez csak azt akadályozza meg, hogy *más* meghamisítsa az archívumot, azt nem, hogy *én* megtegyem ezt (hiszen én tudnék hamisított MD5 lenyomatot gyártani a hamisított archívumhoz). Ez ellen az jelent védelmet, hogy az `archive.sqlite` tartalmazza minden poszt egyedi azonosítóját, tehát ha ilyen vita támadna, akkor azt ugyan a vitatkozó felek maguk nem tudnák eldönteni, de a Meta – hacsak nem feltételezzük, hogy összeesküdött valamelyik féllel – igen, hiszen náluk is megvannak a posztok és az azonosítók, így eldönthető, hogy adott azonosító létezik-e, illetve mi van a hozzá tartozó posztban.)

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
- Videók – esetleg képek – integritásvizsgálata (esetleges letöltési hibákra tekintettel).
