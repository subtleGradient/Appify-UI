(function () {
  var suggestions = [];
  var loaded = false;

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(message, isError) {
    var status = $("status");
    if (!status) return;
    status.innerHTML = "";
    status.appendChild(document.createTextNode(message));
    status.className = isError ? "status notice-text" : "status";
  }

  function clearResults() {
    var box = $("suggestions");
    if (box) box.innerHTML = "";
  }

  function renderResults(matches) {
    var box = $("suggestions");
    var ul;
    var i;
    var item;
    var link;
    var text;

    if (!box) return;
    box.innerHTML = "";

    if (!matches.length) {
      box.appendChild(document.createTextNode("No suggestions yet."));
      return;
    }

    ul = document.createElement("ul");

    for (i = 0; i < matches.length; i += 1) {
      item = document.createElement("li");
      link = document.createElement("a");
      link.href = matches[i].href;
      link.appendChild(document.createTextNode(matches[i].title));
      text = document.createTextNode(" - " + matches[i].summary);
      item.appendChild(link);
      item.appendChild(text);
      ul.appendChild(item);
    }

    box.appendChild(ul);
  }

  function findMatches(query) {
    var needle = query.toLowerCase();
    var matches = [];
    var i;
    var haystack;

    if (!needle) return [];

    for (i = 0; i < suggestions.length; i += 1) {
      haystack = [
        suggestions[i].title,
        suggestions[i].summary,
        suggestions[i].keywords.join(" ")
      ].join(" ").toLowerCase();

      if (haystack.indexOf(needle) !== -1) {
        matches.push(suggestions[i]);
      }

      if (matches.length === 5) break;
    }

    return matches;
  }

  function updateSuggestions() {
    var input = $("search-box");
    var query = input ? input.value.replace(/^\s+|\s+$/g, "") : "";

    if (!query) {
      clearResults();
      setStatus(
        loaded
          ? "Start typing to search the static suggestion file."
          : "Loading static suggestions...",
        false
      );
      return;
    }

    if (!loaded) {
      setStatus("Suggestions are still loading. The directory below still works.", false);
      return;
    }

    renderResults(findMatches(query));
    setStatus("Suggestions loaded from ./api/suggest.json with XMLHttpRequest.", false);
  }

  function loadSuggestions() {
    var xhr = new XMLHttpRequest();

    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;

      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          suggestions = JSON.parse(xhr.responseText).suggestions || [];
          loaded = true;
          setStatus("Start typing to search the static suggestion file.", false);
          updateSuggestions();
        } catch (error) {
          setStatus("Suggestion data is malformed; use the static directory below.", true);
        }
      } else {
        setStatus("Suggestions are unavailable; use the static directory below.", true);
      }
    };

    try {
      xhr.open("GET", "./api/suggest.json", true);
      xhr.send(null);
    } catch (error) {
      setStatus("XMLHttpRequest could not load suggestions here; use the directory below.", true);
    }
  }

  function hookSearch() {
    var input = $("search-box");
    var form = $("search-form");

    if (input) {
      input.onkeyup = updateSuggestions;
      input.onchange = updateSuggestions;
    }

    if (form) {
      form.onsubmit = function () {
        updateSuggestions();
        return false;
      };
    }
  }

  window.onload = function () {
    hookSearch();
    loadSuggestions();
  };
})();
