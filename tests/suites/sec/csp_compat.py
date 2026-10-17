"""Run the existing Playwright suites against the app WITH its Content-Security-Policy.

Playwright's wait_for_function() compiles the predicate with eval() inside the page – the app's CSP
(script-src 'self', no 'unsafe-eval') rightly refuses that. Page.evaluate() goes through the DevTools
protocol and is not affected, so wait_for_function is re-implemented as an evaluate() polling loop.
Nothing else is changed: the CSP stays fully active (no bypass_csp)."""
import time
from playwright.sync_api import Page, Frame, TimeoutError as PWTimeout


def _poll(self, expression, arg=None, timeout=None, polling=None):
    limit = (30000 if timeout is None else timeout) / 1000.0
    end = time.time() + (limit if limit > 0 else 1e9)
    expr = expression.strip()
    first = expr.split('\n', 1)[0][:120]
    is_fn = expr.startswith(('(', 'function', 'async')) or '=>' in first
    interval = (polling / 1000.0) if isinstance(polling, (int, float)) else 0.05
    last = None
    while True:
        try:
            v = self.evaluate(expr, arg) if is_fn else self.evaluate(expr)
            if v:
                return v
        except Exception as e:  # navigation in progress etc.
            last = e
        if time.time() > end:
            raise PWTimeout(f'wait_for_function (CSP-safe polling) timed out: {expr[:120]} {last or ""}')
        time.sleep(interval)


Page.wait_for_function = _poll
Frame.wait_for_function = _poll
