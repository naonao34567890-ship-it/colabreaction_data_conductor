'use strict';

// Open collapsed UI controls through their actual summary elements before use.
// Keep Playwright's visibility checks enabled: never use force-click or DOM click
// to hide regressions in the real interface.
async function clickInDisclosure(page, selector) {
  const control = page.locator(selector);
  const closedAncestors = control.locator('xpath=ancestor::details[not(@open)]');
  while (await closedAncestors.count()) {
    const outermost = closedAncestors.last();
    await outermost.locator('xpath=./summary[1]').click({timeout:5000});
  }
  await control.click({timeout:5000});
}

module.exports = {clickInDisclosure};
