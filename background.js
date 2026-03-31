var defaultSettings = {
  maxTabs: 10,
  badgeFormat: "openTabs",
  errorTitle: "Too many tabs opened",
  errorContent: "Max Tabs Limit: {maxTabs}"
};
var currentSettings = {};
var managArr;
var localArr;
var isLoading = false;

//add default and managed values to local storage & then to variable
//Do not overwrite local storage unless locked = true in managed storage.
async function loadStorageValues() {
  //Make double-sure it does not cause infinite recursions!!
  isLoading = true;
  browser.storage.onChanged.removeListener(configUpdated);
  //always reset locked to prevent a case where managed storage is removed, leaving the settings unchangeable
  await browser.storage.local.remove("locked");
  //get the keys of the local storage as an array, useful for not overwriting things
  await browser.storage.local.get().then(data => {localArr = Object.keys(data);});
  //get the keys of the managed storage as an array, if there is an error just save the error which is NOT an array
  await browser.storage.managed.get().then(data => {managArr = Object.keys(data);}, err => {managArr = err});
  /*
  If browser.storage.managed.get() does not throw an error, it will be an array.
  We prioritize the managed settings by adding, or if locked overwriting, first and only then adding the default settings for missing entries after everything else.
  */
  if (Array.isArray(managArr)) {
    let result = await browser.storage.managed.get("locked");
    //if locked overwrite instead of add
    if (result.locked === true) {
      //Can't use .forEach as that causes some async shenanigans because await does not work on it
      for (const key of managArr) {
        await writeManagedToLocal(key);
      }
    } else {
      //filter out already existing keys
      let toRemove = new Set(localArr);
      let toSet = managArr.filter( x => !toRemove.has(x) );
      //only set variables not already set
      for (const key of toSet) {
        await writeManagedToLocal(key);
      }
    }
  }
  //lastly always add the default values to ensure nothing required stays empty
  //Refresh localArr
  await browser.storage.local.get().then(data => {localArr = Object.keys(data);})
  //filter out already existing keys
  let toRemove = new Set(localArr);
  let toSet = Object.keys(defaultSettings).filter( x => !toRemove.has(x) );
  for (const key of toSet) {
    await browser.storage.local.set({[key]: defaultSettings[key]});
  }

  //Copy entire local storage to variable for easy non-async access
  await browser.storage.local.get().then(data => {localArr = Object.keys(data);});
  for (const key of localArr) {
    await writeLocalToVariable(key);
  }

  //If config gets updated in settings page reload everything
  browser.storage.onChanged.addListener(configUpdated);
  isLoading = false;
}

async function writeManagedToLocal(key) {
  let manval;
  await browser.storage.managed.get(key).then(data => {manval = data[key];});
  await browser.storage.local.set({[key]: manval});
}

async function writeLocalToVariable(key) {
  let locval;
  await browser.storage.local.get(key).then(data => {locval = data[key];});
  currentSettings[key] = locval;
}

/*
Update the browser when the number of tabs changes.
Update the badge. Including text and color.
Notify user, when too many tabs were opened.
*/
function updateCount(tabId, isOnRemoved) {
  browser.tabs.query({})
  .then((tabs) => {
    let length = tabs.length;
    if (tabId == undefined) {
      updateBadge(length);
      return;
    }

    // onRemoved fires too early and the count is one too many.
    // see https://bugzilla.mozilla.org/show_bug.cgi?id=1396758
    if (isOnRemoved && tabId && tabs.map((t) => { return t.id; }).includes(tabId)) {
      length--;
    }
    // Only limit number of tabs other than preferences
    isPreferencesWindow = tabId.title == null || tabId.title.includes("about");
    isNewTabWindow = tabId.title != null && tabId.title.includes("about:newtab");
    // Do not block any about pages except for newtab. about:home and about:welcome are also blocked as they start an about:newtab page first.
    isBlockable = !isPreferencesWindow || isNewTabWindow;
    if (!isOnRemoved && length > currentSettings["maxTabs"] && isBlockable) {
      //Don't notify if title is empty
      if (currentSettings["errorTitle"] != "") {
        browser.notifications.create({
          "type": "basic",
          "iconUrl": browser.runtime.getURL("icons/link-48.png"),
          "title": currentSettings["errorTitle"],
          "message": currentSettings["errorContent"].replaceAll("{maxTabs}", currentSettings["maxTabs"])
        });
      }
      browser.tabs.remove(tabId.id);
    }

    updateBadge(length);

  });
}

/*
Display tab count on badge and switch color depending on how close user is to maxTabs limit.
*/
function updateBadge(length) {
  switch(currentSettings["badgeFormat"]) {
    case "openTabs":
      browser.browserAction.setBadgeText({text: length.toString()});
      break;
    case "remainingTabs":
      browser.browserAction.setBadgeText({text: (currentSettings["maxTabs"] - length).toString()});
      break;
    case "openTabsMax":
      browser.browserAction.setBadgeText({text: length.toString() + "/" + currentSettings["maxTabs"].toString()});
      break;
    case "remainingTabsMax":
      browser.browserAction.setBadgeText({text: (currentSettings["maxTabs"] - length).toString() + "/" + currentSettings["maxTabs"].toString()});
      break;
    //in case managed storage or something else creates an invalid setting, fall back to openTabs
    default:
      browser.browserAction.setBadgeText({text: length.toString()});
  }

  if (length > currentSettings["maxTabs"] * 0.7) {
    browser.browserAction.setBadgeBackgroundColor({'color': 'red'});
  } else if (length > currentSettings["maxTabs"] * 0.3) {
    browser.browserAction.setBadgeBackgroundColor({'color': 'yellow'});
  } else {
    browser.browserAction.setBadgeBackgroundColor({'color': 'green'});
  }
}

/*
Retrieve the values of the updated config from storage and update the UI accordingly.
*/
async function configUpdated() {
  if (!isLoading) {
    await loadStorageValues();
  } else {
    console.error("configUpdated got called while isLoading is true! This should not happen!");
    return;
  }
  browser.tabs.query({})
  .then((tabs) => {
    let length = tabs.length;
    updateBadge(length);
  });
}

async function main() {
  await loadStorageValues()
  updateCount();
  /*
  Listen to when user adds or removes tabs.
  */
  browser.tabs.onRemoved.addListener(
    (tabId) => { updateCount(tabId, true);
  });
  browser.tabs.onCreated.addListener(
    (tabId) => { updateCount(tabId, false);
  });
}

//Have to do it like this to be able to use await on loadStorageValues
main()
//Do not put stuff after main(), since it will be immediatly executed before main since it's async.