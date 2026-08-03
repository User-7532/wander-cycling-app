-- Allow a free-text category when the user picks "その他" in the UI, instead
-- of being locked to the fixed enum.
alter table status_posts drop constraint if exists status_posts_category_check;
