# Engineering Specification: Zero-Backend Read-Only Web Archive for 650,000 Facebook Posts

Build a complete, performant, production-ready, zero-backend fully static web application for querying, searching, filtering, and displaying a 650,000-row read-only Facebook post archive stored in a single SQLite database hosted on Cloudflare R2 using `@sqlite.org/sqlite-wasm`.

The application must:

- have no application backend
- run entirely in the browser
- be deployable to GitHub Pages
- access SQLite directly from the browser using `@sqlite.org/sqlite-wasm`
- retrieve SQLite database pages using HTTP Range requests rather than downloading the entire database
- query the database using SQLite/SQL/FTS5
- never load the full dataset into JavaScript
- never create hundreds of thousands of DOM elements
- remain responsive on desktop and reasonably usable on tablets/mobile
- be optimized for the immutable, read-only nature of the archive

Treat this specification as both an implementation brief and an acceptance-test specification.

If a requirement is technically impossible with the selected implementation, identify the problem explicitly, explain why, and implement the closest safe alternative rather than silently violating the requirement.

## 1. Environment and Infrastructure Specifications

GitHub repository:

- GitHub username: `ferenci-tamas`
- Repository: `fb-politika-archivum`

The frontend is hosted on GitHub Pages. GitHub Pages should contain only the static frontend/application files.

All frontend asset URLs and application configuration must work correctly under the GitHub Pages repository path.

The SQLite database and images are hosted on **Cloudflare R2**. The public base URL is `https://fb-politika-archivum.medstat.hu`.

Cloudflare R2 contains:

- The parts of the SQLite database as static objects under `/database/<built_at>/part-<part_number>.bin`. You can find the information on the latest `<built_at>` and the parts in `/database/latest.json` that is, `https://fb-politika-archivum.medstat.hu/database/latest.json`.
- The images under `/images/`. Therefore, for example: `example.jpg` must be referenced as: `https://fb-politika-archivum.medstat.hu/images/example.jpg`.

Use long-lived caching for the immutable database and images where appropriate.

The application should obtain the R2 database URL from a build-time configuration value rather than scattering the URL throughout the source code.

The archive is immutable: the approximately 650,000 posts will not change after the initial import. It is not necessary to implement data editing, deletion, insertion, or synchronization functionality. Optimize the architecture for read-only access.

## 2. Database Schema

To see the database schema, check `SQLite-converter.R`, which creates the database.
  
The connection between `posts` and `links`, and the connection between `posts` and `images` is both 1:N, i.e., each post can have arbitrary number of links and images, including zero. `links` and `images` are available as separate tables in the database, but they are also embedded in `posts`; use this when it is faster.

The frontend must query FTS5 rather than downloading all posts and performing search in JavaScript.

Search results must be obtained from SQLite and only the rows required for the current view should be rendered.

If useful, support normal SQLite FTS5 features such as phrase searching and multiple search terms.

Handle malformed or special search input gracefully rather than allowing it to break the query.

Texts are in Hungarian.

## 3. @sqlite.org/sqlite-wasm

Use `@sqlite.org/sqlite-wasm` to access the SQLite database directly from the browser over HTTP Range requests.

The complete SQLite database must NOT be downloaded before the application can be used.

Use HTTP range requests so that the browser retrieves only the required portions of the SQLite database.

Verify that the deployed R2 endpoint supports the HTTP Range behavior required by `@sqlite.org/sqlite-wasm`. Do not merely assume that it works.

Test the actual deployed database URL.

The application must not require a traditional backend API.

Prevent UI thread locks when `@sqlite.org/sqlite-wasm` makes range requests over the network. All SQLite initialization, VFS operations, network-backed database operations, and SQL execution must occur inside a dedicated Web Worker. The main UI thread must never perform blocking SQLite operations.

Ensure Cloudflare R2 sends correct CORS headers.

Implement graceful error handling if HTTP Range requests fail or return 200 OK instead of 206 Partial Content.

## 4. R2 CORS

Configure CORS for the R2 bucket as required by the actual implementation.

The configuration must support:

- requests originating from the GitHub Pages site
- HTTP range requests for the SQLite database
- any cross-origin requests required by `@sqlite.org/sqlite-wasm`
- image access if the implementation requires CORS for images

Use the minimum necessary origins, methods and headers.

Do not simply use unrestricted `*` CORS unless it is technically necessary.

Include the R2 CORS configuration in the repository and document how to apply it.

## 5. Frontend table

Do not use DataTables, or any other heavy third-party library. Implement a custom HTML table.

Only the rows needed for the current view should be retrieved from SQLite and rendered.

Use ordinary HTML/CSS/JavaScript unless a framework provides a clear advantage. Avoid unnecessary dependencies.

The table should contain:

1. Author. Plain text representation.
2. Date/time. Human-readable Hungarian date formatting (`YYYY. mm. dd. HH:MM`).
3. Text. Long posts must not make individual table rows unreasonably tall. Use a sensible approach such as limited-height preview, line clamping, expandable text, "Expand/Collapse" ("Megnyitás / Kevesebb") functionality. Expanding a post must not require downloading the entire dataset; the complete text for that post is already available from the current database query. Preserve: Unicode, line breaks, punctuation, links/text as appropriate.
4. Post URL. The Facebook post URL should be displayed as a clickable link. Clicking on it opens the corresponding URL in a new browser tab. Display a short label such as `Megnyitás` rather than the full URL, while retaining the full URL in the link target and accessible text.
5. Links. For each post with links, display: `1  2  3  ...`. Each number must be a clickable link. Clicking a number opens the corresponding URL in a new browser tab. Next to each number display a small status indicator: green dot = link is available, red dot = link is not available. The status indicator must have an accessible textual description through `aria-label`, `title`, or equivalent. Do not rely on color alone to communicate availability. If a post contains no links, the Links cell must be empty.
6. Images. For each post with images, display: `1  2  3  ...`. Each number must be a clickable link. Clicking a number opens the corresponding URL in a new browser tab. If a post contains no images, the Images cell must be empty.

## 6. Searching

Provide a prominent full-text search box. Search must use the SQLite FTS5 index.

Support normal FTS5 capabilities where practical, including:

- multiple terms
- phrase searches
- quoted phrases
- normal FTS5 operators where explicitly supported

When the user searches, query SQLite and display only the current page of matching results.

Provide a clear way to:

- execute a search
- clear the search
- return to the unfiltered archive

Display a useful message when there are no matching posts.

Handle search errors gracefully.

Provide one-click search purge to return to default chronological feed.

Hungarian queries contain diacritics (`á, é, í, ó, ö, ő, ú, ü, ű`). The search engine must respect these characters.

## 7. Filtering

Provide practical filters for the following:

- Author (multi-select or search-supported dropdown; do not scan all posts in JavaScript to build the author list)
- Date range (the underlying SQL must filter on `posts.time`; convert UI dates into appropriate UNIX timestamp boundaries)

Filtering must be implemented with SQL queries.

Provide one-click filter purge to return to default chronological feed.

## 8. Search and Filter Interaction

Search, filters, and sorting must be composable.

The application should support combinations such as:

- search + author
- search + date range
- search + author + date range
- search + sorting

## 9. Sorting

Allow sorting by useful fields, including at least:

- post date
- author

Sorting must be performed by SQLite. Never retrieve all records and sort them in JavaScript.

Do not sort 650,000 records in JavaScript.

Use stable ordering.

When sorting by a non-unique column, include the post ID or another unique field as a tie-breaker.

## 10. Pagination and Navigation Controls

Display a manageable number of rows per view, for example:

- 50
- 100
- 250

Allow the user to choose the page size.

Implement Keyset (Cursor-Based) Pagination for default/chronological scrolling to keep deep pagination constant-time instead of degrading with large `OFFSET` queries.

The UI may provide:

- Newer (Újabb)
- Older (Régebbi)
- Newest (Legújabb)
- Oldest (Legrégebbi)

or another intuitive pagination mechanism.

For conventional page numbers, ensure that navigating deep into the archive does not require increasingly expensive SQLite queries.

Use fast methods where full pagination counts are requested.

## 11. Security and data integrity

Every external link rendered must include `target="_blank"` and `rel="noopener noreferrer"`.

Validate all external post, link, and image URLs to guarantee they use `http://` or `https://` schemas. Block malicious schemes like `javascript:`, `data:`, or `vbscript:`.

All data originating from the database must be treated as untrusted. Render text strictly using `textContent` or robust HTML escaping utilities.

In particular:

- never inject post text into HTML using unsafe methods
- safely escape text
- validate/sanitize URLs before creating clickable links
- do not execute HTML or JavaScript contained in post text
- safely handle malformed URLs

Do not put credentials, API tokens, account IDs, or other secrets into the repository or client-side JavaScript.

Execute all queries using prepared SQL statements with parameter bindings (`?`). Never construct SQL by directly concatenating untrusted user input.

The UI should not contain scattered raw SQL statements.

## 12. User interface and Accessibility

Primary interface text in Hungarian. Use Hungarian UI labels.

Create a clean, fast archive-browsing interface.

The page should include:

- page title
- search box
- filters
- sorting controls
- result count where practical
- table
- pagination/navigation controls
- loading indicator
- useful error messages

Provide feedback indicators: distinct visual states for Initial Database Loading (VFS initialization), Query Pending, Empty Results, and Network Error messages.

The application must work on:

- desktop browsers
- tablets
- mobile browsers

Use responsive design.

On narrow screens, horizontal table scrolling is acceptable. The table must remain usable when horizontal scrolling is necessary.

The UI should be accessible:

- keyboard navigation
- appropriate semantic HTML
- visible focus states
- accessible buttons and links
- status information not conveyed through color alone

## 13. Performance

Performance is an important requirement.

The application must be tested against the full approximately 650,000-post archive.

It must NOT:

- download the database in the browser
- load all posts into JavaScript
- create 650,000 DOM rows
- perform full-dataset filtering in JavaScript
- perform full-dataset sorting in JavaScript
- download all images during initial page load or

Only data necessary for the current query/view should be retrieved. Never execute `SELECT * FROM posts JOIN links JOIN images` across the full dataset. Avoid downloading large volumes of SQLite database pages when joining 1:N relations (`links` and `images`).

Because the database is immutable, use aggressive but appropriate HTTP caching for the SQLite database and static assets.

The application should behave correctly with multiple concurrent users. There should be no per-user server-side state.

## 14. Validation and testing

Before considering the project complete, test the application against the actual full dataset.

Verify:

- link availability indicators are correct
- image URLs are correct
- Facebook URLs work
- FTS5 searches work
- author filtering works
- date filtering works
- sorting works
- pagination works
- deep navigation remains responsive
- long post text displays correctly
- empty link/image cells are handled correctly
- malformed/empty values do not break the UI
- database range requests work against the deployed R2 object
- GitHub Pages deployment works under `/fb-politika-archivum/`
- multiple independent browser sessions work simultaneously

Test with the production-sized database, not merely a small sample.

## 15. Deliverables

Create the complete project, including:

- frontend source code
- custom table implementation
- `@sqlite.org/sqlite-wasm` integration
- R2 configuration, including CORS
- GitHub Pages deployment configuration
- package/dependency configuration
- tests where appropriate
- README

Do not merely provide pseudocode, architectural suggestions, or partial examples.

The README must explain:

1. Project architecture.
2. SQLite schema.
3. How to build the frontend locally.
4. How to run the website locally.
5. How to configure Cloudflare R2.
6. How to configure R2 CORS.
7. How to deploy GitHub Pages.
8. How the browser accesses SQLite using `@sqlite.org/sqlite-wasm`.
9. How HTTP range requests are used.
10. How to reproduce/validate the production build.
11. Expected database size and any relevant performance characteristics.

## 16. Acceptance Criteria

The implementation is complete only when all of the following are true:

### Architecture

- [ ] No runtime backend exists.
- [ ] GitHub Pages serves only static assets.
- [ ] SQLite is accessed directly from the browser.
- [ ] SQLite operations run in a Web Worker.
- [ ] `@sqlite.org/sqlite-wasm` is used for HTTP-backed SQLite access.
- [ ] The complete database is not downloaded at startup.

### Database

- [ ] Existing schema is supported.
- [ ] Existing FTS5 index is used.
- [ ] 1:N links/images are hydrated separately.
- [ ] Queries use prepared statements.
- [ ] No user input is concatenated into SQL.

### Search

- [ ] Full-text search uses FTS5.
- [ ] Hungarian diacritics work.
- [ ] Phrase searching works.
- [ ] Malformed FTS input does not crash the application.
- [ ] Search results are paginated in SQLite.

### Filtering

- [ ] Author filtering works.
- [ ] Date filtering works.
- [ ] Filters execute in SQLite.
- [ ] Search and filters can be combined.

### Sorting

- [ ] Date sorting works.
- [ ] Author sorting works.
- [ ] Sorting is performed by SQLite.
- [ ] Ordering is deterministic.

### Pagination

- [ ] Page sizes 50/100/250 are supported.
- [ ] Chronological navigation uses keyset pagination.
- [ ] Deep navigation does not degrade.

### Rendering

- [ ] Only current-page rows are rendered.
- [ ] Long text can be expanded/collapsed.
- [ ] Post URLs work.
- [ ] Link numbers work.
- [ ] Link availability is accessible without relying solely on color.
- [ ] Image links work.
- [ ] Empty link/image cells work.

### Security

- [ ] Database text is rendered safely.
- [ ] URLs are validated.
- [ ] `javascript:`/`data:`/`vbscript:` URLs are rejected.
- [ ] External links use `noopener noreferrer`.
- [ ] No secrets are committed.

### Infrastructure

- [ ] R2 Range requests have been tested or the inability to test them is explicitly documented.
- [ ] CORS configuration is provided.
- [ ] CORS exposes the headers required by the VFS.
- [ ] GitHub Pages works under `/fb-politika-archivum/`.

 ### Performance

- [ ] Tested with the production-sized database.
- [ ] No full dataset is loaded into JavaScript.
- [ ] No full dataset is rendered.
- [ ] No full-dataset client-side filtering/sorting/search exists.
- [ ] Images are not downloaded at startup.
- [ ] Network-backed SQLite operations do not block the UI thread.