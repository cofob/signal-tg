use std::ops::Deref;

use crate::error::ErrorStack;

/// Types that BoringSSL keeps in stacks
pub trait Stackable {}

/// An ordered list, like BoringSSL's `STACK_OF`
#[derive(Clone, Debug)]
pub struct StackRef<T> {
    items: Vec<T>,
}

#[derive(Clone, Debug)]
pub struct Stack<T>(StackRef<T>);

impl<T> Stack<T> {
    pub fn new() -> Result<Stack<T>, ErrorStack> {
        Ok(Stack(StackRef { items: Vec::new() }))
    }

    pub fn push(&mut self, data: T) -> Result<(), ErrorStack> {
        self.0.items.push(data);
        Ok(())
    }

    pub(crate) fn from_vec(items: Vec<T>) -> Stack<T> {
        Stack(StackRef { items })
    }
}

impl<T> Deref for Stack<T> {
    type Target = StackRef<T>;

    fn deref(&self) -> &StackRef<T> {
        &self.0
    }
}

impl<T> StackRef<T> {
    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn iter(&self) -> std::slice::Iter<'_, T> {
        self.items.iter()
    }

    pub(crate) fn as_slice(&self) -> &[T] {
        &self.items
    }
}

impl<'a, T> IntoIterator for &'a StackRef<T> {
    type Item = &'a T;
    type IntoIter = std::slice::Iter<'a, T>;

    fn into_iter(self) -> Self::IntoIter {
        self.items.iter()
    }
}

impl<'a, T> IntoIterator for &'a Stack<T> {
    type Item = &'a T;
    type IntoIter = std::slice::Iter<'a, T>;

    fn into_iter(self) -> Self::IntoIter {
        self.0.items.iter()
    }
}
