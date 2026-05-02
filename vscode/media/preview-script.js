/**
 * SCEpter Claims — Markdown Preview Script
 *
 * Runs inside the markdown preview webview. Adds rich hover tooltips to
 * .scepter-ref elements using data-* attributes embedded by the
 * markdown-it plugin (vscode/src/markdown-plugin.ts).
 *
 * Tooltip behaviour mirrors the editor hover (vscode/src/hover-provider.ts):
 *   - claim or bare-claim → two render modes: "original-claim" when the
 *     hovered span is on the claim's own definition line in the same
 *     note, "reference-to-claim" elsewhere. The reference mode uses a
 *     two-column layout (refs panel | body panel) with independent scroll.
 *   - note → existing single-pane note excerpt layout.
 *   - section → simple stub.
 *   - range expansions (data-claim-range-members) → one row per member,
 *     each row clickable to drill into a single-claim hover.
 *
 * The script does NOT make any synchronous calls into the extension host;
 * everything required for rendering is pre-encoded on data attributes by
 * the plugin. Click navigation uses `command:vscode.open?...` URIs the
 * same way our cross-project links do.
 */
(function () {
  'use strict';

  var tooltip = null;
  var isTooltipMutation = false;
  var hideTimer = null;
  var currentRef = null;
  /** Stack of refs we've drilled into (for range-member → single-claim
   * traversal). Each entry is the originating element so we can render
   * its tooltip again on "back". */
  var drillStack = [];

  function createTooltip() {
    if (tooltip) return tooltip;
    tooltip = document.createElement('div');
    tooltip.className = 'scepter-tooltip';
    tooltip.style.cssText = [
      'position: fixed',
      'z-index: 10000',
      'max-width: 720px',
      'min-width: 280px',
      'max-height: 70vh',
      'overflow-y: auto',
      'overflow-x: hidden',
      'padding: 10px 14px',
      'border-radius: 4px',
      'font-size: 13px',
      'line-height: 1.5',
      'display: none',
      'box-shadow: 0 2px 8px rgba(0,0,0,0.3)',
      'background: var(--vscode-editorHoverWidget-background, #2d2d2d)',
      'color: var(--vscode-editorHoverWidget-foreground, #cccccc)',
      'border: 1px solid var(--vscode-editorHoverWidget-border, #454545)',
      'font-family: var(--vscode-editor-font-family, monospace)',
      'word-wrap: break-word',
    ].join(';');

    // Keep tooltip visible when mouse enters it
    tooltip.addEventListener('mouseenter', function () { cancelHide(); });
    tooltip.addEventListener('mouseleave', function () { scheduleHide(); });

    // Trap scroll events inside the tooltip (and its column scroll regions)
    // so wheel input doesn't leak to the page.
    tooltip.addEventListener('wheel', function (e) {
      // If the wheel is happening inside an inner scroll region, let that
      // region absorb it; only fall back to the outer tooltip otherwise.
      var inner = findInnerScroller(e.target);
      var target = inner || tooltip;
      var atTop = target.scrollTop === 0;
      var atBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 1;
      if (target.scrollHeight > target.clientHeight) {
        if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) return;
        e.stopPropagation();
        e.preventDefault();
        target.scrollTop += e.deltaY;
      }
    }, { passive: false });

    document.body.appendChild(tooltip);
    return tooltip;
  }

  function findInnerScroller(node) {
    while (node && node !== tooltip && node.nodeType === 1) {
      if (node.classList && node.classList.contains('scepter-scroll')) return node;
      node = node.parentNode;
    }
    return null;
  }

  function cancelHide() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  }

  function scheduleHide() {
    cancelHide();
    hideTimer = setTimeout(hideTooltip, 150);
  }

  // --- Rendering ---------------------------------------------------------

  function showTooltip(el) {
    cancelHide();
    currentRef = el;
    drillStack = [];
    var tip = createTooltip();
    var html = renderTooltipContent(el, /*allowDrill*/ true);
    if (!html) return;

    isTooltipMutation = true;
    tip.innerHTML = html;
    bindInternalLinks(tip);
    positionTooltip(el);
    setTimeout(function () { isTooltipMutation = false; }, 0);
  }

  function renderTooltipContent(el, allowDrill) {
    var kind = el.getAttribute('data-scepter-kind');
    var rangeMembersJson = el.getAttribute('data-claim-range-members');
    if (rangeMembersJson) {
      return renderRangeHover(el, rangeMembersJson);
    }
    if (kind === 'claim' || kind === 'bare-claim') {
      return renderClaimHover(el);
    }
    if (kind === 'note') {
      return renderNoteHover(el);
    }
    if (kind === 'section') {
      return renderSectionHover(el);
    }
    return '';
  }

  function renderClaimHover(el) {
    var fqid = el.getAttribute('data-claim-fqid');
    var heading = el.getAttribute('data-claim-heading');
    var noteType = el.getAttribute('data-note-type');
    var noteTitle = el.getAttribute('data-note-title');
    var noteFile = el.getAttribute('data-note-file');
    var line = el.getAttribute('data-claim-line');
    var importance = el.getAttribute('data-importance');
    var lifecycle = el.getAttribute('data-lifecycle');
    var derivesFrom = el.getAttribute('data-derives-from');
    var contextHtml = el.getAttribute('data-claim-context');
    var rawContext = el.getAttribute('data-claim-context-raw');
    var refsJson = el.getAttribute('data-claim-refs');
    var linkHref = el.tagName === 'A' ? el.getAttribute('href') : null;
    var sourceLine = el.getAttribute('data-scepter-source-line');
    var contextNote = el.getAttribute('data-scepter-context-note');

    if (!fqid) {
      // Fallback: id present but not in index.
      var id = el.getAttribute('data-scepter-id') || '';
      return '<div style="font-weight:600;color:#808080">' + esc(id) + '</div>' +
        '<div style="font-size:11px;opacity:0.7">Not in current index</div>';
    }

    // Detect "original claim" mode: the rendered span sits on the same
    // line as the claim's own definition AND the wrapping note id matches
    // the claim's note. When true, the user is already reading the claim;
    // skip body excerpt and file:line link and surface metadata + refs only.
    var fqNoteId = fqid.split('.')[0];
    var isOriginal = (
      sourceLine &&
      line &&
      contextNote &&
      contextNote === fqNoteId &&
      parseInt(sourceLine, 10) === parseInt(line, 10)
    );

    var badges = buildBadgesHtml(importance, lifecycle, derivesFrom);
    var refsPanel = refsJson ? buildRefsPanelHtml(refsJson) : '';

    if (isOriginal) {
      // Single-column layout: header + metadata + refs.
      var html = '';
      html += '<div style="font-weight:600;color:#4EC9B0;margin-bottom:4px">' + esc(fqid) + '</div>';
      html += '<div style="color:#9cdcfe;margin-bottom:6px">' +
        '<i>' + esc(noteType || '') + '</i> — ' + escMarkdownLike(noteTitle || '') + '</div>';
      if (heading) {
        html += '<div style="margin-bottom:6px">' + escMarkdownLike(heading) + '</div>';
      }
      if (badges) {
        html += '<div style="font-size:11px;opacity:0.7;margin-bottom:6px">' + badges + '</div>';
      }
      if (refsPanel) {
        html += '<div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:8px;margin-top:6px">' +
          refsPanel + '</div>';
      }
      return html;
    }

    // Reference-to-claim mode: two-column layout.
    var bodyPanel = buildBodyPanelHtml({
      fqid: fqid,
      noteType: noteType,
      noteTitle: noteTitle,
      noteFile: noteFile,
      line: line,
      linkHref: linkHref,
      badges: badges,
      contextHtml: contextHtml,
      rawContext: rawContext,
    });

    var twoCol = '';
    twoCol += '<div class="scepter-tooltip-cols">';
    twoCol += '<div class="scepter-tooltip-col scepter-scroll">' + (refsPanel || '<i style="opacity:0.6">No references.</i>') + '</div>';
    twoCol += '<div class="scepter-tooltip-col scepter-scroll">' + bodyPanel + '</div>';
    twoCol += '</div>';
    return twoCol;
  }

  function buildBadgesHtml(importance, lifecycle, derivesFrom) {
    var parts = [];
    if (importance) parts.push('importance: ' + esc(importance));
    if (lifecycle) parts.push('lifecycle: ' + esc(lifecycle));
    if (derivesFrom) parts.push('derives from: ' + esc(derivesFrom));
    if (parts.length === 0) return '';
    return '<i>' + parts.join(' · ') + '</i>';
  }

  function buildBodyPanelHtml(args) {
    var html = '';
    html += '<div style="font-weight:600;color:#4EC9B0;margin-bottom:4px">' + esc(args.fqid) + '</div>';
    html += '<div style="color:#9cdcfe;margin-bottom:4px">' +
      '<i>' + esc(args.noteType || '') + '</i> — ' + escMarkdownLike(args.noteTitle || '') + '</div>';
    if (args.noteFile) {
      var pathLabel = escMarkdownLike(args.noteFile) + (args.line ? ':' + esc(args.line) : '');
      if (args.linkHref) {
        html += '<div style="margin-bottom:4px">' +
          '<a href="' + escAttr(args.linkHref) + '" style="color:#4EC9B0;text-decoration:none">' +
          pathLabel + '</a></div>';
      } else {
        html += '<div style="margin-bottom:4px;opacity:0.7">' + pathLabel + '</div>';
      }
    }
    if (args.badges) {
      html += '<div style="font-size:11px;opacity:0.7;margin-bottom:6px">' + args.badges + '</div>';
    }
    // Body excerpt — render as word-wrapped block with a "show more"
    // affordance when the raw text is longer than the initial slice.
    if (args.contextHtml || args.rawContext) {
      html += '<div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:6px;margin-top:4px">';
      if (args.rawContext) {
        // Stash the raw context on a hidden textarea-like element so the
        // "show more" buttons can read it. Encoded as data attribute for
        // simpler escape semantics.
        var initialSlice = sliceBody(args.rawContext, 0, 12); // first 12 lines
        html += '<div class="scepter-tooltip-excerpt scepter-body-excerpt" ' +
          'data-scepter-raw="' + escAttr(args.rawContext) + '" ' +
          'data-scepter-start="' + initialSlice.start + '" ' +
          'data-scepter-end="' + initialSlice.end + '" ' +
          'style="white-space: pre-wrap; word-break: break-word; opacity: 0.95; font-size:12px">';
        if (initialSlice.canShowMoreAbove) {
          html += '<div class="scepter-show-more" data-direction="above" style="text-align:center;margin-bottom:4px">' +
            '<button class="scepter-show-more-btn" data-direction="above">↑ show 12 more lines above</button></div>';
        }
        html += '<div class="scepter-body-text">' + escMarkdownLike(initialSlice.text) + '</div>';
        if (initialSlice.canShowMoreBelow) {
          html += '<div class="scepter-show-more" data-direction="below" style="text-align:center;margin-top:4px">' +
            '<button class="scepter-show-more-btn" data-direction="below">↓ show 12 more lines below</button></div>';
        }
        html += '</div>';
      } else if (args.contextHtml) {
        // Pre-rendered HTML excerpt — embed directly. No show-more here
        // because we don't have the raw lines for the slice math.
        html += '<div class="scepter-tooltip-excerpt" style="font-size:12px;opacity:0.95">' +
          args.contextHtml + '</div>';
      }
      html += '</div>';
    }
    return html;
  }

  function sliceBody(raw, start, count) {
    var lines = raw.split('\n');
    var n = lines.length;
    var s = Math.max(0, start);
    var e = Math.min(n, s + count);
    return {
      text: lines.slice(s, e).join('\n'),
      start: s,
      end: e,
      canShowMoreAbove: s > 0,
      canShowMoreBelow: e < n,
    };
  }

  function buildRefsPanelHtml(refsJson) {
    var data;
    try { data = JSON.parse(refsJson); } catch (e) { return ''; }
    var sources = data.sources || [];
    var groups = data.noteGroups || [];

    var html = '';
    html += '<div class="scepter-refs-panel">';

    // Sources subsection
    html += '<div class="scepter-refs-section">';
    html += '<div class="scepter-refs-heading">Sources (' + sources.length + ')</div>';
    if (sources.length === 0) {
      html += '<div style="opacity:0.6"><i>No source references.</i></div>';
    } else {
      var srcOpen = sources.length <= 5;
      html += '<details class="scepter-refs-details"' + (srcOpen ? ' open' : '') + '>';
      html += '<summary style="' + (sources.length <= 5 ? 'display:none' : '') + '">' +
        sources.length + ' source reference' + (sources.length === 1 ? '' : 's') + '</summary>';
      html += '<ul class="scepter-refs-list">';
      for (var i = 0; i < sources.length; i++) {
        var src = sources[i];
        html += '<li><a href="' + escAttr(src.href) + '" class="scepter-refs-link">' +
          escMarkdownLike(src.rel) + ':' + esc(String(src.line)) + '</a></li>';
      }
      html += '</ul>';
      html += '</details>';
    }
    html += '</div>';

    // Notes subsection
    var totalNoteRefs = 0;
    for (var g = 0; g < groups.length; g++) totalNoteRefs += (groups[g].items || []).length;

    html += '<div class="scepter-refs-section">';
    html += '<div class="scepter-refs-heading">Notes (' + totalNoteRefs + ')</div>';
    if (totalNoteRefs === 0) {
      html += '<div style="opacity:0.6"><i>No note references.</i></div>';
    } else {
      var groupsOpen = groups.length <= 3;
      for (var j = 0; j < groups.length; j++) {
        var grp = groups[j];
        var refs = grp.items || [];
        var defaultOpen = groupsOpen && refs.length <= 5;
        html += '<details class="scepter-refs-details scepter-refs-group"' + (defaultOpen ? ' open' : '') + '>';
        html += '<summary>';
        if (grp.noteHref) {
          html += '<a href="' + escAttr(grp.noteHref) + '" class="scepter-refs-grouplink">' +
            '<b>' + esc(grp.noteId) + '</b></a>';
        } else {
          html += '<b>' + esc(grp.noteId) + '</b>';
        }
        if (grp.noteType) html += ' — <i>' + esc(grp.noteType) + '</i>';
        if (grp.noteTitle && grp.noteTitle !== grp.noteId) {
          html += ': ' + escMarkdownLike(grp.noteTitle);
        }
        html += ' <span class="scepter-refs-count">(' + refs.length + ')</span>';
        html += '</summary>';
        html += '<ul class="scepter-refs-list">';
        for (var k = 0; k < refs.length; k++) {
          var item = refs[k];
          var linkLabel = '<a href="' + escAttr(item.href) + '" class="scepter-refs-link">' +
            esc(item.localId) + '</a>';
          if (item.kind === 'derivation') {
            html += '<li>' + linkLabel + ' — <i>derivation</i>: ' +
              escMarkdownLike(item.headingExcerpt || '') + '</li>';
          } else {
            // snippetHtml is pre-built and trusted (server-side escaped)
            html += '<li>' + linkLabel + ' — ' + (item.snippetHtml || '') + '</li>';
          }
        }
        html += '</ul>';
        html += '</details>';
      }
    }
    html += '</div>';

    html += '</div>';
    return html;
  }

  function renderRangeHover(el, membersJson) {
    var members;
    try { members = JSON.parse(membersJson); } catch (e) { return ''; }
    if (!Array.isArray(members) || members.length === 0) return '';

    var first = members[0];
    var last = members[members.length - 1];
    var html = '';
    html += '<div style="font-weight:600;margin-bottom:6px">' +
      'Range <code>' + esc(first.fqid) + '</code> – <code>' + esc(last.fqid) + '</code> · ' +
      '<i>' + members.length + ' claim' + (members.length === 1 ? '' : 's') + '</i></div>';
    html += '<ul class="scepter-range-list">';
    for (var i = 0; i < members.length; i++) {
      var m = members[i];
      if (!m.found) {
        html += '<li><b>' + esc(m.fqid) + '</b> — <i>not in index</i></li>';
        continue;
      }
      var href = m.noteFile && m.line ? makeOpenHref(m.noteFile, m.line) : null;
      // Each row is clickable to drill into a single-claim hover. We
      // synthesize the drill click via a custom data attribute the
      // tooltip click handler reads.
      var titlePart = m.noteTitle ? ' (' + escMarkdownLike(m.noteTitle) + ')' : '';
      html += '<li>';
      if (href) {
        html += '<a href="' + escAttr(href) + '" class="scepter-range-link"><b>' +
          esc(m.fqid) + '</b></a>';
      } else {
        html += '<b>' + esc(m.fqid) + '</b>';
      }
      html += ' — <i>' + esc(m.noteType || '') + '</i>' + titlePart + ': ' +
        escMarkdownLike(m.heading || '');
      html += '</li>';
    }
    html += '</ul>';
    return html;
  }

  function renderNoteHover(el) {
    var id = el.getAttribute('data-scepter-id');
    var noteType = el.getAttribute('data-note-type');
    var noteTitle = el.getAttribute('data-note-title');
    var noteFile = el.getAttribute('data-note-file');
    var claimCount = el.getAttribute('data-claim-count');
    var noteExcerpt = el.getAttribute('data-note-excerpt');
    var linkHref = el.tagName === 'A' ? el.getAttribute('href') : null;

    if (!noteTitle) {
      return '<div style="font-weight:600;color:#808080">' + esc(id || '') + '</div>' +
        '<div style="font-size:11px;opacity:0.7">Not in current index</div>';
    }

    var html = '';
    if (linkHref) {
      html += '<div style="font-weight:600;margin-bottom:4px">' +
        '<a href="' + escAttr(linkHref) + '" style="color:#4EC9B0;text-decoration:none">' +
        esc(id || '') + ' — ' + escMarkdownLike(noteTitle) + '</a></div>';
    } else {
      html += '<div style="font-weight:600;color:#4EC9B0;margin-bottom:4px">' +
        esc(id || '') + ' — ' + escMarkdownLike(noteTitle) + '</div>';
    }
    html += '<div style="color:#9cdcfe;margin-bottom:4px"><i>' + esc(noteType || '') + '</i>';
    if (claimCount) {
      var n = parseInt(claimCount, 10);
      html += ' · ' + n + ' claim' + (n !== 1 ? 's' : '');
    }
    html += '</div>';
    if (noteExcerpt) {
      html += '<div class="scepter-tooltip-excerpt" style="border-top:1px solid rgba(255,255,255,0.1);' +
        'padding-top:6px;margin-top:4px;font-size:12px;opacity:0.9">' + noteExcerpt + '</div>';
    }
    html += '<div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:6px;margin-top:6px;font-size:11px;opacity:0.5">';
    if (noteFile) html += escMarkdownLike(noteFile);
    if (linkHref) {
      html += '  <a href="' + escAttr(linkHref) + '" style="color:#4EC9B0;opacity:1;margin-left:8px">Open note →</a>';
    }
    html += '</div>';
    return html;
  }

  function renderSectionHover(el) {
    var id = el.getAttribute('data-scepter-id');
    return '<div style="opacity:0.7">Section §' + esc(id || '') + '</div>';
  }

  // --- Click handlers / show-more / drill-in ---------------------------

  function bindInternalLinks(tip) {
    // "Show more above/below" body excerpt buttons.
    var btns = tip.querySelectorAll('.scepter-show-more-btn');
    btns.forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var direction = btn.getAttribute('data-direction');
        var excerpt = btn.closest('.scepter-body-excerpt');
        if (!excerpt) return;
        var raw = excerpt.getAttribute('data-scepter-raw') || '';
        var start = parseInt(excerpt.getAttribute('data-scepter-start') || '0', 10);
        var end = parseInt(excerpt.getAttribute('data-scepter-end') || '0', 10);
        var step = 12;
        if (direction === 'above') start = Math.max(0, start - step);
        else end = end + step;
        var slice = sliceBody(raw, start, end - start);
        excerpt.setAttribute('data-scepter-start', String(slice.start));
        excerpt.setAttribute('data-scepter-end', String(slice.end));
        // Rebuild the excerpt body
        var textDiv = excerpt.querySelector('.scepter-body-text');
        if (textDiv) {
          isTooltipMutation = true;
          textDiv.innerHTML = escMarkdownLike(slice.text);
          setTimeout(function () { isTooltipMutation = false; }, 0);
        }
        // Toggle button visibility
        var aboveBtn = excerpt.querySelector('.scepter-show-more[data-direction="above"]');
        var belowBtn = excerpt.querySelector('.scepter-show-more[data-direction="below"]');
        if (aboveBtn) aboveBtn.style.display = slice.canShowMoreAbove ? '' : 'none';
        if (belowBtn) belowBtn.style.display = slice.canShowMoreBelow ? '' : 'none';
      });
    });

    // Stop click bubbling on `<details>` summaries so clicking expand/
    // collapse doesn't trigger anchor navigation.
    var summaries = tip.querySelectorAll('details > summary');
    summaries.forEach(function (s) {
      s.addEventListener('click', function (e) { e.stopPropagation(); });
    });
  }

  // --- Tooltip positioning --------------------------------------------

  function positionTooltip(el) {
    var rect = el.getBoundingClientRect();
    var left = rect.left;
    var top = rect.bottom + 4;
    if (top + 200 > window.innerHeight) {
      top = rect.top - 4;
      tooltip.style.transform = 'translateY(-100%)';
    } else {
      tooltip.style.transform = 'none';
    }
    if (left + 720 > window.innerWidth) {
      left = Math.max(4, window.innerWidth - 730);
    }
    tooltip.style.left = Math.max(4, left) + 'px';
    tooltip.style.top = top + 'px';
    tooltip.style.display = 'block';
  }

  function hideTooltip() {
    cancelHide();
    currentRef = null;
    if (tooltip && tooltip.style.display !== 'none') {
      isTooltipMutation = true;
      tooltip.style.display = 'none';
      setTimeout(function () { isTooltipMutation = false; }, 0);
    }
  }

  // --- Helpers --------------------------------------------------------

  function esc(s) {
    if (s == null) return '';
    var d = document.createElement('span');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function escAttr(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  /**
   * HTML-escape a string. The webview embeds these strings into
   * innerHTML, not into a markdown-it pipeline, so we don't need to
   * escape underscores/asterisks (those would only matter if the text
   * went back through markdown). The plugin already markdown-escapes
   * its outputs before encoding into data attributes; here we just
   * guarantee HTML safety.
   */
  function escMarkdownLike(s) {
    return esc(s);
  }

  function makeOpenHref(absPath, line) {
    var args = encodeURIComponent(JSON.stringify([String(absPath), line || 1]));
    return 'command:scepter.previewOpenAt?' + args;
  }

  // --- Listener wiring -------------------------------------------------

  function attachListeners() {
    var refs = document.querySelectorAll('.scepter-ref:not([data-scepter-bound])');
    refs.forEach(function (el) {
      el.setAttribute('data-scepter-bound', '1');
      el.addEventListener('mouseenter', function () { showTooltip(el); });
      el.addEventListener('mouseleave', function () { scheduleHide(); });
    });
  }

  // Reposition tooltip on scroll so it tracks its anchor element.
  window.addEventListener('scroll', function () {
    if (!tooltip || tooltip.style.display === 'none' || !currentRef) return;
    var rect = currentRef.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      hideTooltip();
      return;
    }
    var left = rect.left;
    var top = rect.bottom + 4;
    if (top + 200 > window.innerHeight) {
      top = rect.top - 4;
      tooltip.style.transform = 'translateY(-100%)';
    } else {
      tooltip.style.transform = 'none';
    }
    if (left + 720 > window.innerWidth) left = Math.max(4, window.innerWidth - 730);
    tooltip.style.left = Math.max(4, left) + 'px';
    tooltip.style.top = top + 'px';
  }, { passive: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachListeners);
  } else {
    attachListeners();
  }

  var observer = new MutationObserver(function () {
    if (isTooltipMutation) return;
    attachListeners();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
