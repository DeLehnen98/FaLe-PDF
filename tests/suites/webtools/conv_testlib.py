"""Helpers for the conversion tool tests (agent conv)."""


def set_range(page, id_, value):
    page.evaluate("""([id, v]) => { const i = document.getElementById(id); i.value = String(v);
      i.dispatchEvent(new Event('input', {bubbles: true})); i.dispatchEvent(new Event('change', {bubbles: true})); }""", [id_, value])


def check_radio(page, name, value):
    page.locator(f'input[name="{name}"][value="{value}"]').check(force=True)


def toggle(page, id_, on=True):
    box = page.locator(f'#{id_}')
    if box.is_checked() != on:
        page.locator(f'label[for={id_}]').click()


def shots(s, page, tool, phase, top=None, dark=False):
    s.shot(page, f'{tool}_phone_{phase}', top=top)
    if dark:
        page.emulate_media(color_scheme='dark')
        s.shot(page, f'{tool}_phone_{phase}_dark', top=top)
        page.emulate_media(color_scheme='light')


def result_text(page):
    return page.locator('.wt-result').inner_text()


def back_to_files(page):
    page.locator('.wt-restart button').first.click()
    page.wait_for_selector('.wt-files:not([hidden]), .wt-file', timeout=10000)
