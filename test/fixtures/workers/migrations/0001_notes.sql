CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT NOT NULL, words INTEGER NOT NULL DEFAULT 0);
CREATE TABLE log (id INTEGER PRIMARY KEY, path TEXT NOT NULL);
CREATE TRIGGER count_words AFTER INSERT ON notes
BEGIN
  UPDATE notes SET words = length(NEW.text) - length(replace(NEW.text, ' ', '')) + 1 WHERE id = NEW.id;
END;
