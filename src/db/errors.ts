/** Domain error with a stable code that the UI translates (errors.<code>). */
export class DataError extends Error {
  constructor(
    public code:
      | 'required'
      | 'duplicateStudentNo'
      | 'classNotFound'
      | 'sectionNotFound'
      | 'sectionClassMismatch'
      | 'classHasStudents'
      | 'sectionHasStudents'
      | 'duplicateName'
      | 'studentNotFound'
      | 'invalidImport'
      | 'photoTrialOnly',
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'DataError';
  }
}
