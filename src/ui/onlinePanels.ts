import { BoardError, type Leaderboard } from '../online';
import { randomCallsign } from '../online/callsign';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const CALLSIGN_ERRORS: Record<string, string> = {
  callsign_length: 'Use 2–12 characters.',
  callsign_chars: 'Letters, numbers, _ - . only.',
  callsign_format: 'Use 2–12 letters, numbers, _ - or .',
  callsign_banned: 'That name is not allowed.',
  callsign_taken: 'That name is already taken.',
};

/**
 * Modal for the pilot name. `welcome` is the first-run version: it asks for a name, starts empty with
 * a suggestion as the placeholder, and can only be closed by saving one.
 */
export class CallsignDialog {
  private readonly root = $('callsign');
  private readonly input = $<HTMLInputElement>('callsign-input');
  private readonly error = $('callsign-error');
  private readonly cancel = $('btn-callsign-cancel');
  private saving = false;
  private welcome = false;

  constructor(
    private readonly board: Leaderboard,
    private readonly onSaved: (callsign: string) => void,
  ) {
    $('btn-callsign-random').addEventListener('click', () => {
      this.input.value = randomCallsign();
      this.input.focus();
    });
    $('btn-callsign-save').addEventListener('click', () => void this.save());
    this.cancel.addEventListener('click', () => this.close());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.save();
      if (e.key === 'Escape' && !this.welcome) this.close();
    });
  }

  get isOpen() {
    return !this.root.classList.contains('hidden');
  }

  open(current: string, welcome = false) {
    this.welcome = welcome;
    $('callsign-title').textContent = welcome ? 'WELCOME, PILOT' : 'PILOT NAME';
    $('callsign-text').textContent = welcome
      ? 'What should we call you? 2–12 letters, numbers, _ - or .'
      : '2–12 characters: letters, numbers, _ - or .';
    $('btn-callsign-save').textContent = welcome ? "LET'S DRIVE" : 'Save';
    this.cancel.classList.toggle('hidden', welcome);
    this.input.value = welcome ? '' : current;
    this.input.placeholder = welcome ? current || randomCallsign() : 'Your name';
    this.error.textContent = '';
    this.root.classList.remove('hidden');
    this.input.focus();
    this.input.select();
  }

  close() {
    this.root.classList.add('hidden');
    this.input.blur();
  }

  private async save() {
    if (this.saving) return;
    // In the welcome prompt an empty box takes the suggested name.
    const name = this.input.value.trim() || (this.welcome ? this.input.placeholder : '');
    this.saving = true;
    this.error.textContent = '';
    try {
      const saved = await this.board.setCallsign(name);
      this.onSaved(saved);
      this.close();
    } catch (e) {
      const code = e instanceof BoardError ? e.code : 'network';
      this.error.textContent = CALLSIGN_ERRORS[code] ?? 'Could not save your name. Please try again.';
    } finally {
      this.saving = false;
    }
  }
}
