/**
 * SCEpter Claims — Markdown Preview Script
 *
 * Runs inside the markdown preview webview. Adds hover tooltips
 * to .scepter-ref elements using data-* attributes embedded by
 * the markdown-it plugin.
 */
(function () {
  'use strict';

  var tooltip = null;
  var isTooltipMutation = false;
  var hideTimer = null;
  var currentRef = null;


  function createTooltip() {
    if (tooltip) return tooltip;
    tooltip = document.createElement('div');
    tooltip.className = 'scepter-tooltip';
    tooltip.style.cssText = [
      'position: fixed',
      'z-index: 10000',
      'max-width: 600px',
      'min-width: 240px',
      'max-height: 50vh',
      'overflow-y: auto',
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
    tooltip.addEventListener('mouseenter', function () {
      cancelHide();
    });
    tooltip.addEventListener('mouseleave', function () {
      scheduleHide();
    });

    // Trap scroll events inside the tooltip so scrolling the tooltip content
    // doesn't leak to the page (which would reposition/dismiss the tooltip).
    tooltip.addEventListener('wheel', function (e) {
      var atTop = tooltip.scrollTop === 0;
      var atBottom = tooltip.scrollTop + tooltip.clientHeight >= tooltip.scrollHeight - 1;

      // Only trap if there's content to scroll, or we're not at a boundary
      if (tooltip.scrollHeight > tooltip.clientHeight) {
        if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) {
          // At boundary — let it propagate so the page scrolls naturally
          return;
        }
        // Mid-scroll inside tooltip — prevent page from scrolling
        e.stopPropagation();
        e.preventDefault();
        tooltip.scrollTop += e.deltaY;
      }
    }, { passive: false });

    document.body.appendChild(tooltip);
    return tooltip;
  }

  function cancelHide() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function scheduleHide() {
    cancelHide();
    hideTimer = setTimeout(function () {
      hideTooltip();
    }, 150);
  }

  function showTooltip(el) {
    cancelHide();
    currentRef = el;
    var tip = createTooltip();
    var kind = el.getAttribute('data-scepter-kind');
    var id = el.getAttribute('data-scepter-id');
    var html = '';

    // Build a link href from the element's <a> tag if it has one
    var linkHref = el.tagName === 'A' ? el.getAttribute('href') : null;

    if (kind === 'claim' || kind === 'bare-claim') {
      var fqid = el.getAttribute('data-claim-fqid');
      var heading = el.getAttribute('data-claim-heading');
      var noteType = el.getAttribute('data-note-type');
      var noteTitle = el.getAttribute('data-note-title');
      var noteFile = el.getAttribute('data-note-file');
      var line = el.getAttribute('data-claim-line');
      var importance = el.getAttribute('data-importance');

      if (fqid) {
        // Clickable title
        if (linkHref) {
          html += '<div style="font-weight:600;margin-bottom:4px"><a href="' + escAttr(linkHref) + '" style="color:#4EC9B0;text-decoration:none">' + esc(fqid) + '</a></div>';
        } else {
          html += '<div style="font-weight:600;color:#4EC9B0;margin-bottom:4px">' + esc(fqid) + '</div>';
        }
        html += '<div style="color:#9cdcfe;margin-bottom:6px">' + esc(noteType || '') + ' — ' + esc(noteTitle || '') + '</div>';
        if (heading) {
          html += '<div style="margin-bottom:6px">' + esc(heading) + '</div>';
        }
        // Metadata
        var meta = [];
        if (importance) meta.push('importance: ' + esc(importance));
        if (meta.length > 0) {
          html += '<div style="font-size:11px;opacity:0.7;margin-bottom:6px">' + meta.join(' · ') + '</div>';
        }
        // Pre-rendered HTML claim context from data attribute
        var context = el.getAttribute('data-claim-context');
        if (context) {
          html += '<div class="scepter-tooltip-excerpt" style="border-top:1px solid rgba(255,255,255,0.1);padding-top:6px;margin-top:4px;font-size:12px;opacity:0.9">' + context + '</div>';
        }
        // Footer with file path and open link
        if (noteFile) {
          html += '<div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:6px;margin-top:6px;font-size:11px;opacity:0.5">';
          html += esc(noteFile) + (line ? ':' + line : '');
          if (linkHref) {
            html += '  <a href="' + escAttr(linkHref) + '" style="color:#4EC9B0;opacity:1;margin-left:8px">Open →</a>';
          }
          html += '</div>';
        }
      } else {
        html += '<div style="font-weight:600;color:#808080">' + esc(id || '') + '</div>';
        html += '<div style="font-size:11px;opacity:0.7">Not in current index</div>';
      }
    } else if (kind === 'note') {
      var noteType2 = el.getAttribute('data-note-type');
      var noteTitle2 = el.getAttribute('data-note-title');
      var noteFile2 = el.getAttribute('data-note-file');
      var claimCount = el.getAttribute('data-claim-count');
      if (noteTitle2) {
        // Clickable title — always show the full title, never truncate
        if (linkHref) {
          html += '<div style="font-weight:600;margin-bottom:4px"><a href="' + escAttr(linkHref) + '" style="color:#4EC9B0;text-decoration:none">' + esc(id || '') + ' — ' + esc(noteTitle2) + '</a></div>';
        } else {
          html += '<div style="font-weight:600;color:#4EC9B0;margin-bottom:4px">' + esc(id || '') + ' — ' + esc(noteTitle2) + '</div>';
        }
        html += '<div style="color:#9cdcfe;margin-bottom:4px">' + esc(noteType2 || '');
        if (claimCount) {
          var n = parseInt(claimCount, 10);
          html += ' · ' + n + ' claim' + (n !== 1 ? 's' : '');
        }
        html += '</div>';
        // Pre-rendered HTML note excerpt from data attribute
        var noteExcerpt = el.getAttribute('data-note-excerpt');
        if (noteExcerpt) {
          html += '<div class="scepter-tooltip-excerpt" style="border-top:1px solid rgba(255,255,255,0.1);padding-top:6px;margin-top:4px;font-size:12px;opacity:0.9">' + noteExcerpt + '</div>';
        }
        // Footer with open link
        html += '<div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:6px;margin-top:6px;font-size:11px;opacity:0.5">';
        if (noteFile2) {
          html += esc(noteFile2);
        }
        if (linkHref) {
          html += '  <a href="' + escAttr(linkHref) + '" style="color:#4EC9B0;opacity:1;margin-left:8px">Open note →</a>';
        }
        html += '</div>';
      } else {
        html += '<div style="font-weight:600;color:#808080">' + esc(id || '') + '</div>';
        html += '<div style="font-size:11px;opacity:0.7">Not in current index</div>';
      }
    } else if (kind === 'section') {
      html += '<div style="opacity:0.7">Section §' + esc(id || '') + '</div>';
    }

    if (!html) return;

    isTooltipMutation = true;
    tip.innerHTML = html;

    // Position below the element
    var rect = el.getBoundingClientRect();
    var left = rect.left;
    var top = rect.bottom + 4;

    // Flip above if too close to bottom
    if (top + 150 > window.innerHeight) {
      top = rect.top - 4;
      tip.style.transform = 'translateY(-100%)';
    } else {
      tip.style.transform = 'none';
    }

    // Keep within viewport horizontally
    if (left + 400 > window.innerWidth) {
      left = window.innerWidth - 410;
    }

    tip.style.left = Math.max(4, left) + 'px';
    tip.style.top = top + 'px';
    tip.style.display = 'block';

    setTimeout(function () { isTooltipMutation = false; }, 0);
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

  function esc(s) {
    var d = document.createElement('span');
    d.textContent = s;
    return d.innerHTML;
  }

  function escAttr(s) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function attachListeners() {
    var refs = document.querySelectorAll('.scepter-ref:not([data-scepter-bound])');
    refs.forEach(function (el) {
      el.setAttribute('data-scepter-bound', '1');
      el.addEventListener('mouseenter', function () {
        showTooltip(el);
      });
      el.addEventListener('mouseleave', function () {
        scheduleHide();
      });
    });
  }

  // Reposition tooltip on scroll so it tracks its anchor element.
  // If the anchor scrolls out of the viewport, dismiss the tooltip.
  window.addEventListener('scroll', function () {
    if (!tooltip || tooltip.style.display === 'none' || !currentRef) return;
    var rect = currentRef.getBoundingClientRect();
    // Dismiss if the anchor is no longer visible
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      hideTooltip();
      return;
    }
    // Reposition to follow the anchor
    var left = rect.left;
    var top = rect.bottom + 4;
    if (top + 150 > window.innerHeight) {
      top = rect.top - 4;
      tooltip.style.transform = 'translateY(-100%)';
    } else {
      tooltip.style.transform = 'none';
    }
    if (left + 400 > window.innerWidth) {
      left = window.innerWidth - 410;
    }
    tooltip.style.left = Math.max(4, left) + 'px';
    tooltip.style.top = top + 'px';
  }, { passive: true });

  // Attach on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachListeners);
  } else {
    attachListeners();
  }

  // Re-attach when markdown content changes (ignore our own tooltip mutations)
  var observer = new MutationObserver(function () {
    if (isTooltipMutation) return;
    attachListeners();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
