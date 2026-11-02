import { countsText, maskEmail } from '../syncText';

it('describes the upload and masks the email', () => {
  expect(countsText({ notes: 42, subjects: 5, folders: 1, cards: 0 })).toBe('42 notes, 5 subjects, 1 folder');
  expect(countsText({})).toBe('nothing yet');
  expect(maskEmail('rey.student@gmail.com')).toBe('r•••@gmail.com');
  expect(maskEmail(null)).toBe('your account');
});
