import { SubjectNotFoundError } from "./errors";
import type { Subject } from "./types";

export class SubjectRegistry {
  private subjects = new Map<string, Subject>();
  private activeSubjectId: string | null = null;

  create(subject: Subject): void {
    this.subjects.set(subject.id, subject);
    if (!this.activeSubjectId) {
      this.activeSubjectId = subject.id;
    }
  }

  get(id: string): Subject {
    const subject = this.subjects.get(id);
    if (!subject) throw new SubjectNotFoundError(id);
    return subject;
  }

  getActive(): Subject | null {
    if (!this.activeSubjectId) return null;
    return this.subjects.get(this.activeSubjectId) ?? null;
  }

  setActive(id: string): void {
    if (!this.subjects.has(id)) throw new SubjectNotFoundError(id);
    this.activeSubjectId = id;
  }

  update(id: string, updates: Partial<Omit<Subject, "id">>): Subject {
    const existing = this.get(id);
    const updated = { ...existing, ...updates };
    this.subjects.set(id, updated);
    return updated;
  }

  list(): Subject[] {
    return Array.from(this.subjects.values());
  }

  delete(id: string): void {
    this.subjects.delete(id);
    if (this.activeSubjectId === id) {
      const remaining = this.subjects.keys().next();
      this.activeSubjectId = remaining.done ? null : remaining.value;
    }
  }

  loadFromSnapshot(subjects: Subject[], activeId: string | null): void {
    this.subjects.clear();
    for (const subject of subjects) {
      this.subjects.set(subject.id, subject);
    }
    this.activeSubjectId = activeId;
  }

  toSnapshot(): { subjects: Subject[]; activeId: string | null } {
    return {
      subjects: this.list(),
      activeId: this.activeSubjectId,
    };
  }
}
