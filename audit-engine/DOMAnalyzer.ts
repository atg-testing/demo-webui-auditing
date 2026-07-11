import { Page } from '@playwright/test';

export interface FieldRaw {
  locator: string;
  tagName: string;
  id?: string;
  name?: string;
  type?: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
  autocomplete?: string;
  pattern?: string;
  maxLength?: number;
  minLength?: number;
  classNames?: string;
}

export interface FieldDefinition {
  element: FieldRaw;
  inferredCategory: string;
}

export class DOMAnalyzer {
  public async extractFields(page: Page): Promise<FieldDefinition[]> {
    const fieldsData = await page.locator(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea, select'
    ).evaluateAll((elements) => {
      return elements.flatMap((el, index) => {
        const input = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        // Exclude visually hidden fields (honeypots, anti-spam traps like ak_hp_textarea)
        // A field is a honeypot if it or any ancestor is display:none or visibility:hidden
        const style = window.getComputedStyle(input);
        if (style.display === 'none' || style.visibility === 'hidden') return [];
        // Also exclude by common honeypot name/id patterns (Akismet, CF7, etc.)
        const nameAttr = (input.name || '').toLowerCase();
        const idAttr = (input.id || '').toLowerCase();
        const honeypotPatterns = ['ak_hp', 'honeypot', 'hp_', '_trap', 'bot_field', 'gotcha'];
        if (honeypotPatterns.some(p => nameAttr.includes(p) || idAttr.includes(p))) return [];
        let labelText = '';
        if (input.id) {
          const lbl = document.querySelector(`label[for="${input.id}"]`);
          if (lbl) labelText = lbl.textContent?.trim() || '';
        }
        if (!labelText) {
          const closest = input.closest('label');
          if (closest) labelText = closest.textContent?.trim() || '';
        }
        let locator = '';
        if (input.id) locator = `#${input.id}`;
        else if (input.name) locator = `[name="${input.name}"]`;
        else locator = `xpath=(//input | //textarea | //select)[${index + 1}]`;
        return [{
          locator, tagName: input.tagName.toLowerCase(),
          id: input.id || undefined, name: input.name || undefined,
          type: (input as HTMLInputElement).type || undefined,
          label: labelText || undefined,
          placeholder: input.getAttribute('placeholder') || undefined,
          required: input.required || input.getAttribute('aria-required') === 'true',
          autocomplete: (input as HTMLInputElement).autocomplete || undefined,
          pattern: input.getAttribute('pattern') || undefined,
          maxLength: input.hasAttribute('maxlength') ? parseInt(input.getAttribute('maxlength') || '0', 10) : undefined,
          minLength: input.hasAttribute('minlength') ? parseInt(input.getAttribute('minlength') || '0', 10) : undefined,
          classNames: input.className || undefined,
        }];
      });
    });
    return fieldsData.map(d => ({ element: d, inferredCategory: 'UNKNOWN' }));
  }
}
