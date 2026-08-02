-- Handover docs, safety training, and trip tips are being simplified into a
-- single external-links "資料" page instead of full in-app document/quiz
-- systems. These tables were never populated; safe to drop.
drop table if exists safety_training_results;
drop table if exists safety_training_questions;
drop table if exists safety_training_modules;
drop table if exists handover_documents;
drop table if exists trip_tip_photos;
drop table if exists trip_tips;
